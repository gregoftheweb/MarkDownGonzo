mod commands;
mod export;
mod print;

use std::path::PathBuf;
use tauri::{Emitter, Manager};

/// Work around a WebKitGTK shutdown crash on Linux.
///
/// On exit, `WebKitWebProcess` runs an atexit handler that destroys the DMABUF
/// renderer's GBM device (`gbm_device_destroy` -> Mesa `dri_gbm`), which faults
/// in glibc's allocator because the DRI/GBM state is already torn down. The
/// segfault happens after our window is gone, but it still produces a
/// systemd-coredump notification on nearly every quit. See
/// `docs/handoff-2026-08-30.md`.
///
/// Disabling the DMABUF renderer makes WebKit use the SHM compositing path, which
/// never creates the GBM device, so the faulty teardown never runs. GPU
/// compositing is not needed for this editor. A user or distributor can still
/// override this by exporting the variable themselves.
#[cfg(all(desktop, target_os = "linux"))]
fn apply_webkit_shutdown_workaround() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(not(all(desktop, target_os = "linux")))]
fn apply_webkit_shutdown_workaround() {}

/// Whether the app should run under a tiling Wayland compositor that manages
/// move/close/tiling itself, so the window's own title bar is redundant.
/// Hyprland (the Omarchy target) is the one we detect today.
fn running_under_hyprland() -> bool {
    std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some()
        || std::env::var("XDG_CURRENT_DESKTOP")
            .map(|value| value.to_ascii_lowercase().contains("hyprland"))
            .unwrap_or(false)
}

/// Resolve the `appearance.window_decorations` preference to an actual state.
/// "auto" is borderless only under a tiling WM; the app draws its own header
/// with the tabs and controls, and elsewhere users still need a native frame to
/// move and close the window.
fn resolve_decorations(preference: &str) -> bool {
    match preference {
        "native" => true,
        "none" => false,
        _ => !running_under_hyprland(),
    }
}

/// Apply the stored window-frame preference at startup. This runs as a
/// belt-and-suspenders call after the window is created because GTK on Wayland
/// does not always honor the initial `decorations` value from `tauri.conf.json`.
fn apply_window_decorations(app: &tauri::App) {
    let preference = commands::read_stored_config()
        .map(|config| config.appearance.window_decorations)
        .unwrap_or_else(|_| "auto".to_string());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_decorations(resolve_decorations(&preference));
    }
}

/// Re-apply the window-frame preference at runtime, so the Settings toggle takes
/// effect without a restart.
#[tauri::command]
fn set_window_decorations(window: tauri::WebviewWindow, preference: String) -> Result<(), String> {
    window
        .set_decorations(resolve_decorations(&preference))
        .map_err(|error| error.to_string())
}

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
    apply_webkit_shutdown_workaround();

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
        .setup(|app| {
            apply_window_decorations(app);
            Ok(())
        })
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
            export::export_document,
            export::pdf_export_available,
            print::render_document_html,
            set_window_decorations,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarkDownGonzo");
}
