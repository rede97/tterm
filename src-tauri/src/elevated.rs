use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use tauri::{Emitter, State};

use crate::{AppState, PtyOutput, PtySession};

#[cfg(target_os = "windows")]
#[allow(dead_code)]
extern "system" {
    fn ShellExecuteW(
        hwnd: isize,
        lpOperation: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShowCmd: i32,
    ) -> isize;

    fn CreateNamedPipeW(
        lpName: *const u16,
        dwOpenMode: u32,
        dwPipeMode: u32,
        nMaxInstances: u32,
        nOutBufferSize: u32,
        nInBufferSize: u32,
        nDefaultTimeOut: u32,
        lpSecurityAttributes: *const u8,
    ) -> isize;

    fn ConnectNamedPipe(
        hNamedPipe: isize,
        lpOverlapped: *const u8,
    ) -> i32;

    fn CreateFileW(
        lpFileName: *const u16,
        dwDesiredAccess: u32,
        dwShareMode: u32,
        lpSecurityAttributes: *const u8,
        dwCreationDisposition: u32,
        dwFlagsAndAttributes: u32,
        hTemplateFile: isize,
    ) -> isize;

    fn CloseHandle(hObject: isize) -> i32;
}

#[cfg(target_os = "windows")]
pub(crate) fn pty_spawn_elevated_windows(
    state: State<AppState>,
    app: tauri::AppHandle,
    cmd_str: &str,
) -> Result<String, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;

    const PIPE_ACCESS_DUPLEX: u32 = 0x00000003;
    const PIPE_TYPE_BYTE: u32 = 0x00000000;
    const PIPE_READMODE_BYTE: u32 = 0x00000000;
    const PIPE_WAIT: u32 = 0x00000000;
    const PIPE_UNLIMITED_INSTANCES: u32 = 255;
    const INVALID_HANDLE_VALUE: isize = -1;
    const ERROR_PIPE_CONNECTED: i32 = 535;

    let pid = std::process::id();
    let pipe_name = format!(r"\\.\pipe\tterm-elev-{}", pid);

    let wide_pipe: Vec<u16> = OsStr::new(&pipe_name)
        .encode_wide()
        .chain(Some(0))
        .collect();

    let pipe_server = unsafe {
        CreateNamedPipeW(
            wide_pipe.as_ptr(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            4096,
            4096,
            5000,
            std::ptr::null(),
        )
    };

    if pipe_server == INVALID_HANDLE_VALUE || pipe_server == 0 {
        return Err("CreateNamedPipeW failed".into());
    }

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe_path.to_string_lossy();
    let params = format!("--elevated-relay \"{}\" \"{}\"", pipe_name, cmd_str);

    let op: Vec<u16> = OsStr::new("runas\0").encode_wide().collect();
    let exe_wide: Vec<u16> = OsStr::new(exe_str.as_ref()).encode_wide().chain(Some(0)).collect();
    let params_wide: Vec<u16> = OsStr::new(&params).encode_wide().chain(Some(0)).collect();

    let shellex_ret = unsafe {
        ShellExecuteW(0, op.as_ptr(), exe_wide.as_ptr(), params_wide.as_ptr(), std::ptr::null(), 0)
    };

    if shellex_ret as i32 <= 32 {
        unsafe { CloseHandle(pipe_server) };
        return Err(format!("ShellExecuteW failed with code {}", shellex_ret));
    }

    let conn_ret = unsafe { ConnectNamedPipe(pipe_server, std::ptr::null()) };
    if conn_ret == 0 {
        let err = std::io::Error::last_os_error();
        let raw = err.raw_os_error().unwrap_or(-1);
        if raw != ERROR_PIPE_CONNECTED {
            unsafe { CloseHandle(pipe_server) };
            return Err(format!("ConnectNamedPipe failed: {}", err));
        }
    }

    let pipe_file = unsafe { std::fs::File::from_raw_handle(pipe_server as *mut std::ffi::c_void) };
    let mut pipe_reader = pipe_file.try_clone().map_err(|e| e.to_string())?;

    let id;
    {
        let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
        id = format!("tab-{}", *next);
        *next += 1;
    }

    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(id.clone(), PtySession {
            master: None,
            writer: Box::new(pipe_file),
        });
    }

    let emit_id = id.clone();
    let emit_handle = app.clone();
    std::thread::spawn(move || {
        let mut len_buf = [0u8; 4];
        loop {
            if pipe_reader.read_exact(&mut len_buf).is_err() {
                break;
            }
            let len = u32::from_le_bytes(len_buf) as usize;
            if len == 0 || len > 65536 {
                break;
            }
            let mut data = vec![0u8; len];
            if pipe_reader.read_exact(&mut data).is_err() {
                break;
            }
            let _ = emit_handle.emit("pty-output", PtyOutput {
                id: emit_id.clone(),
                data,
            });
        }
    });

    Ok(id)
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn elevated_relay_main(pipe_name: &str, shell_cmd: &str) -> ! {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;

    const GENERIC_READ: u32 = 0x80000000;
    const GENERIC_WRITE: u32 = 0x40000000;
    const OPEN_EXISTING: u32 = 3;
    const INVALID_HANDLE_VALUE: isize = -1;

    let wide_pipe: Vec<u16> = OsStr::new(pipe_name)
        .encode_wide()
        .chain(Some(0))
        .collect();

    let pipe_handle = {
        let mut h: isize;
        let mut attempts = 0;
        loop {
            h = unsafe {
                CreateFileW(
                    wide_pipe.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    0,
                    0,
                )
            };
            if h != INVALID_HANDLE_VALUE && h != 0 {
                break h;
            }
            attempts += 1;
            if attempts > 50 {
                std::process::exit(1);
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    };

    let pipe_file = unsafe { std::fs::File::from_raw_handle(pipe_handle as *mut std::ffi::c_void) };
    let mut pipe_reader = pipe_file.try_clone().expect("clone pipe for read");

    let pty_sys = native_pty_system();
    let pty_pair = match pty_sys.openpty(PtySize {
        rows: 25,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(_) => std::process::exit(1),
    };

    if pty_pair.slave.spawn_command(CommandBuilder::new(shell_cmd)).is_err() {
        std::process::exit(1);
    }
    drop(pty_pair.slave);

    let pty_master = pty_pair.master;
    let mut pty_reader = match pty_master.try_clone_reader() {
        Ok(r) => r,
        Err(_) => std::process::exit(1),
    };
    let mut pty_writer = match pty_master.take_writer() {
        Ok(w) => w,
        Err(_) => std::process::exit(1),
    };

    let mut pw = pipe_file;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match pty_reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let len_bytes = (n as u32).to_le_bytes();
                    if pw.write_all(&len_bytes).is_err() { break; }
                    if pw.write_all(&buf[..n]).is_err() { break; }
                    let _ = pw.flush();
                }
            }
        }
        let _ = pw.write_all(&0u32.to_le_bytes());
    });

    let mut type_buf = [0u8; 1];
    let mut len_buf = [0u8; 4];
    let mut buf = [0u8; 4096];

    loop {
        if pipe_reader.read_exact(&mut type_buf).is_err() {
            break;
        }
        match type_buf[0] {
            0x00 => {
                if pipe_reader.read_exact(&mut len_buf).is_err() { break; }
                let len = u32::from_le_bytes(len_buf) as usize;
                let mut remaining = len;
                while remaining > 0 {
                    let n = remaining.min(buf.len());
                    if pipe_reader.read_exact(&mut buf[..n]).is_err() { break; }
                    if pty_writer.write_all(&buf[..n]).is_err() { break; }
                    remaining -= n;
                }
                let _ = pty_writer.flush();
            }
            0x01 => {
                let mut sz = [0u8; 4];
                if pipe_reader.read_exact(&mut sz).is_err() { break; }
                let cols = u16::from_le_bytes([sz[0], sz[1]]);
                let rows = u16::from_le_bytes([sz[2], sz[3]]);
                let _ = pty_master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
            0x02 | _ => break,
        }
    }

    std::process::exit(0);
}
