mod commands;

use std::path::PathBuf;
use tauri::{Emitter, Manager};

fn markdown_paths(args: &[String], cwd: &str) -> Vec<String> {
    args.iter()
        .skip(1)
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                PathBuf::from(cwd).join(path)
            }
        })
        .filter(|path| path.is_file() && commands::is_markdown_path(path))
        .filter_map(|path| path.canonicalize().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = markdown_paths(&args, &cwd);
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_document,
            commands::save_document,
            commands::document_metadata,
            commands::load_session,
            commands::save_session,
            commands::load_config,
            commands::save_config,
            commands::startup_paths,
            commands::open_local_link,
            commands::read_image_data_url,
            commands::import_image_file,
            commands::import_image_bytes,
            commands::trash_image_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarkDownGonzo");
}
