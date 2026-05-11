// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.len() >= 4 && args[1] == "--elevated-relay" {
            tterm_lib::elevated::elevated_relay_main(&args[2], &args[3]);
        }
    }
    tterm_lib::run()
}
