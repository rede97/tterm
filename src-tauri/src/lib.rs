mod cmdparse;
mod config;
mod deadmode;
#[cfg(debug_assertions)]
mod demo;
mod fonts;
mod newline;
mod pty;
mod relay;
mod serial;
#[cfg(windows)]
mod serial_win;
mod share;
mod ssh;
mod sshclient;
mod state;
mod tray;
mod window;
mod wt;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

use state::AppState;

// Single invoke-handler command list for both build profiles: the two cfg'd
// generate_handler! lists used to be hand-synced copies and drifted, so the
// common list lives here and debug builds pass their demo commands as extras.
macro_rules! tterm_commands {
    ($($extra:path),*) => {
        tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_spawn_ssh,
            pty::pty_resize,
            pty::pty_kill,
            window::window_minimize,
            window::window_toggle_maximize,
            window::window_maximize,
            window::window_unmaximize,
            window::window_set_fullscreen,
            window::window_close,
            window::window_request_close,
            window::window_start_drag,
            window::open_new_window,
            window::pick_directory,
            window::save_text_file,
            ssh::ssh_read_config_raw,
            ssh::open_ssh_config,
            ssh::ssh_clear_known_hosts,
            sshclient::session::ssh_spawn_embedded,
            sshclient::prompter::ssh_auth_response,
            sshclient::prompter::ssh_hostkey_response,
            sshclient::forward::ssh_forward_add,
            sshclient::forward::ssh_forward_remove,
            sshclient::forward::ssh_forward_list,
            sshclient::keys::ssh_keygen,
            sshclient::keys::ssh_list_keys,
            sshclient::install::ssh_install_pubkey,
            ssh::ssh_save_config,
            config::read_config_file,
            config::write_config_file,
            config::delete_config_file,
            config::open_config_dir,
            wt::read_wt_settings,
            wt::read_wt_fragments,
            wt::find_vs_instances,
            serial::serial_list_ports,
            serial::serial_spawn,
            serial::serial_set_baud,
            serial::serial_set_output_newline,
            serial::serial_set_dtr,
            serial::serial_set_flow_control,
            serial::serial_disconnect,
            serial::serial_reconnect,
            serial::serial_set_rts,
            serial::serial_line_status,
            relay::session_set_auto_reconnect,
            relay::session_get_auto_reconnect,
            share::share_create,
            share::share_revoke,
            share::share_screen_response,
            share::share_screen_changed,
            tray::tray_set_tabs,
            tray::tray_park_window,
            tray::tray_take_pending_tab,
            fonts::list_system_fonts,
            $($extra),*
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Don't persist FULLSCREEN: F11 fullscreen is a per-session viewing
        // mode, and relaunching into a chrome-ful but fullscreen window
        // would strand the zen state machine. Browsers behave the same way.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Close requests (X button, Alt+F4, taskbar) route through the
        // frontend: prevent, ask via event, and let the frontend's confirm
        // flow re-issue window_close (which sets the confirmed flag) when
        // the user approves.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window::take_close_confirmed() {
                    return; // approved close — let it through
                }
                api.prevent_close();
                use tauri::Emitter;
                let _ = window.emit("window-close-requested", ());
            }
        })
        .setup(|app| {
            // verify PTY system is available
            let _pty_sys = portable_pty::native_pty_system();

            // Unified WebSocket relay hub: single loopback port, path routing,
            // per-process auth token. Must start before any session spawns.
            let hub = relay::WsHub::start()?;
            // The share API (share.rs) requests screen snapshots from the
            // frontend through this event emitter.
            {
                let app_handle = app.handle().clone();
                hub.set_emitter(Box::new(move |event, payload| {
                    use tauri::Emitter;
                    let _ = app_handle.emit(event, payload);
                }));
            }

            app.manage(AppState {
                sessions: Arc::new(Mutex::new(HashMap::new())),
                serial_sessions: Arc::new(Mutex::new(HashMap::new())),
                ssh_sessions: Arc::new(Mutex::new(HashMap::new())),
                auto_reconnect: Arc::new(Mutex::new(HashMap::new())),
                pending_prompts: Arc::new(Mutex::new(HashMap::new())),
                next_id: Mutex::new(1),
                initial_cwd: pty::launch_working_directory(),
                hub,
            });

            // window-state restore uses PhysicalSize via SetWindowPos and
            // bypasses minWidth/minHeight. After restore settles: first launch
            // (no usable `.window-state.json`) gets screen×(1/φ) centered;
            // everyone gets a one-shot min-size clamp. Do NOT hook every
            // Resized — set_min_size/set_size mid-maximize aborts WS_MAXIMIZE
            // on undecorated Windows.
            {
                use tauri::Manager;
                let first_launch = !window::has_saved_window_geometry(app.handle());
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    for win in handle.webview_windows().into_values() {
                        if first_launch {
                            window::apply_golden_default_size(&win);
                        }
                        window::enforce_min_size(&win);
                    }
                });
            }

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler({
            #[cfg(debug_assertions)]
            {
                tterm_commands!(demo::demo_spawn, demo::anime_spawn)
            }
            #[cfg(not(debug_assertions))]
            {
                tterm_commands!()
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                tray::on_exit(app);
            }
        });
}
