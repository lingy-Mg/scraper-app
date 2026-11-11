mod ai;
mod covers;
mod image;
mod javdb;
mod library;
mod media;
mod models;
mod organize;
mod providers;
mod settings;
mod system;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            media::app_info,
            media::scan_folder,
            media::probe_file,
            media::pick_folder,
            organize::organize_files,
            system::trash_files,
            system::open_path,
            system::reveal_path,
            system::window_minimize,
            system::window_toggle_maximize,
            system::window_close,
            settings::load_settings,
            settings::save_settings,
            ai::ai_test,
            ai::ai_identify,
            ai::ai_pick,
            javdb::javdb_identify,
            javdb::javdb_detail,
            library::library_list,
            library::library_upsert,
            library::library_remove,
            library::library_clear,
            providers::tmdb::tmdb_identify,
            providers::tmdb::tmdb_detail,
            providers::bangumi::bangumi_identify,
            providers::bangumi::bangumi_detail,
            covers::cover_cache,
            covers::cover_crop,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
