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
mod ssh;
mod state;
mod window;
mod wt;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // verify PTY system is available
            let _pty_sys = portable_pty::native_pty_system();

            // Unified WebSocket relay hub: single loopback port, path routing,
            // per-process auth token. Must start before any session spawns.
            let hub = relay::WsHub::start()?;

            app.manage(AppState {
                sessions: Arc::new(Mutex::new(HashMap::new())),
                serial_sessions: Arc::new(Mutex::new(HashMap::new())),
                next_id: Mutex::new(1),
                initial_cwd: pty::launch_working_directory(),
                hub,
            });

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler({
            #[cfg(debug_assertions)]
            { tauri::generate_handler![
                pty::pty_spawn, pty::pty_spawn_ssh, pty::pty_resize, pty::pty_kill,
                window::window_minimize, window::window_toggle_maximize, window::window_close,
                window::window_start_drag, window::open_new_window, window::pick_directory, window::save_text_file,
                ssh::ssh_read_config_raw, ssh::open_ssh_config, ssh::ssh_clear_known_hosts,
                ssh::ssh_save_config,
                config::read_config, config::write_config, config::delete_config, config::open_config_dir,
                wt::read_wt_settings, wt::read_wt_fragments, wt::find_vs_instances,
                serial::serial_list_ports, serial::serial_spawn, serial::serial_set_baud,
                serial::serial_set_output_newline,
                demo::demo_spawn, demo::anime_spawn,
                fonts::list_system_fonts,
            ] }
            #[cfg(not(debug_assertions))]
            { tauri::generate_handler![
                pty::pty_spawn, pty::pty_spawn_ssh, pty::pty_resize, pty::pty_kill,
                window::window_minimize, window::window_toggle_maximize, window::window_close,
                window::window_start_drag, window::open_new_window, window::pick_directory, window::save_text_file,
                ssh::ssh_read_config_raw, ssh::open_ssh_config, ssh::ssh_clear_known_hosts,
                ssh::ssh_save_config,
                config::read_config, config::write_config, config::delete_config, config::open_config_dir,
                wt::read_wt_settings, wt::read_wt_fragments, wt::find_vs_instances,
                serial::serial_list_ports, serial::serial_spawn, serial::serial_set_baud,
                serial::serial_set_output_newline,
                fonts::list_system_fonts,
            ] }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
