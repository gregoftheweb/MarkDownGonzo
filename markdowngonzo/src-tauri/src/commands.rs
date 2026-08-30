use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub path: String,
    pub name: String,
    pub content: String,
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedImage {
    pub relative_path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommandError {
    InvalidPath {
        message: String,
    },
    NotFound {
        message: String,
    },
    ExternalChange {
        message: String,
        current_modified_ms: u64,
    },
    Io {
        message: String,
    },
    InvalidState {
        message: String,
    },
    DependencyMissing {
        message: String,
        tool: String,
    },
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub editor: EditorConfig,
    pub fonts: FontsConfig,
    pub appearance: AppearanceConfig,
    pub autosave: AutosaveConfig,
    pub images: ImagesConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct EditorConfig {
    pub font_family: String,
    pub font_size: u16,
    pub code_font_family: String,
    pub code_font_size: u16,
    pub zoom: f32,
    pub spellcheck: bool,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_family: "Roboto".into(),
            font_size: 16,
            code_font_family: "Space Mono".into(),
            code_font_size: 15,
            zoom: 1.0,
            spellcheck: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct FontsConfig {
    pub families: Vec<String>,
}

impl Default for FontsConfig {
    fn default() -> Self {
        Self {
            families: [
                "Roboto",
                "Righteous",
                "Montserrat",
                "Baumans",
                "Space Mono",
                "NovaMono",
                "Roboto Mono",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppearanceConfig {
    pub mode: String,
    pub accent: String,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            mode: "dark".into(),
            accent: "tron".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AutosaveConfig {
    pub enabled: bool,
    pub delay_ms: u64,
}

impl Default for AutosaveConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            delay_ms: 1_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ImagesConfig {
    pub directory: String,
    pub load_remote: bool,
}

impl Default for ImagesConfig {
    fn default() -> Self {
        Self {
            directory: "assets".into(),
            load_remote: true,
        }
    }
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn canonical_document_path(path: &str) -> Result<PathBuf, CommandError> {
    let path = PathBuf::from(path);
    if !is_markdown_path(&path) {
        return Err(CommandError::InvalidPath {
            message: "MarkDownGonzo opens .md and .markdown files".into(),
        });
    }
    path.canonicalize().map_err(|_| CommandError::NotFound {
        message: format!("Document not found: {}", path.display()),
    })
}

pub(crate) fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn state_home() -> Result<PathBuf, CommandError> {
    if let Some(path) = env::var_os("XDG_STATE_HOME") {
        return Ok(PathBuf::from(path).join("markdowngonzo"));
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join(".local/state/markdowngonzo"))
        .ok_or_else(|| CommandError::InvalidState {
            message: "Neither XDG_STATE_HOME nor HOME is available".into(),
        })
}

fn config_home() -> Result<PathBuf, CommandError> {
    if let Some(path) = env::var_os("XDG_CONFIG_HOME") {
        return Ok(PathBuf::from(path).join("markdowngonzo"));
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join(".config/markdowngonzo"))
        .ok_or_else(|| CommandError::InvalidState {
            message: "Neither XDG_CONFIG_HOME nor HOME is available".into(),
        })
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| CommandError::InvalidPath {
        message: format!("Path has no parent: {}", path.display()),
    })?;
    fs::create_dir_all(parent)?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("markdowngonzo");
    let temporary = parent.join(format!(".{file_name}.{stamp}.tmp"));

    let result = (|| -> Result<(), CommandError> {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

fn image_mime(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("svg") => Some("image/svg+xml"),
        _ => None,
    }
}

fn decoded_local_source(source: &str) -> Result<PathBuf, CommandError> {
    let source = source.trim().trim_matches(['<', '>']);
    if source.starts_with("data:") || source.contains("://") {
        return Err(CommandError::InvalidPath {
            message: "Not a local image path".into(),
        });
    }
    let source = source.split(['#', '?']).next().unwrap_or_default();
    let source =
        percent_decode_str(source)
            .decode_utf8()
            .map_err(|_| CommandError::InvalidPath {
                message: "Image path is not valid UTF-8".into(),
            })?;
    Ok(PathBuf::from(source.as_ref()))
}

fn resolve_local_image(document_path: &str, source: &str) -> Result<PathBuf, CommandError> {
    let document = canonical_document_path(document_path)?;
    let source = decoded_local_source(source)?;
    let path = if source.is_absolute() {
        source
    } else {
        document.parent().unwrap_or(Path::new("/")).join(source)
    };
    let path = path.canonicalize().map_err(|_| CommandError::NotFound {
        message: format!("Image not found: {}", path.display()),
    })?;
    if !path.is_file() || image_mime(&path).is_none() {
        return Err(CommandError::InvalidPath {
            message: "The referenced path is not a supported image".into(),
        });
    }
    Ok(path)
}

fn safe_image_stem(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    let cleaned = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let cleaned = cleaned.trim_matches('-');
    if cleaned.is_empty() {
        "image".into()
    } else {
        cleaned.into()
    }
}

fn asset_directory(document: &Path, preferred: &str) -> Result<(PathBuf, String), CommandError> {
    let parent = document.parent().ok_or_else(|| CommandError::InvalidPath {
        message: "Document has no parent directory".into(),
    })?;
    let preferred = Path::new(preferred);
    if preferred.is_absolute() || preferred.components().count() != 1 {
        return Err(CommandError::InvalidPath {
            message: "Asset directory must be one relative folder name".into(),
        });
    }
    let preferred = preferred.to_string_lossy().into_owned();
    let candidates = [preferred.as_str(), "assets", "images", "img"];
    let directory_name = candidates
        .iter()
        .find(|candidate| parent.join(candidate).is_dir())
        .copied()
        .unwrap_or(preferred.as_str())
        .to_string();
    let directory = parent.join(&directory_name);
    fs::create_dir_all(&directory)?;
    Ok((directory, directory_name))
}

fn available_image_path(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    let first = directory.join(format!("{stem}.{extension}"));
    if !first.exists() {
        return first;
    }
    for suffix in 2.. {
        let candidate = directory.join(format!("{stem}-{suffix}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn imported_image(target: &Path, directory_name: &str) -> ImportedImage {
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png")
        .to_string();
    ImportedImage {
        relative_path: format!("{directory_name}/{name}"),
        name,
    }
}

fn write_imported_image(
    document_path: &str,
    bytes: &[u8],
    source_name: &str,
    preferred_directory: &str,
) -> Result<ImportedImage, CommandError> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(CommandError::InvalidPath {
            message: "Images must be 32 MB or smaller".into(),
        });
    }
    let document = canonical_document_path(document_path)?;
    let extension = Path::new(source_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .ok_or_else(|| CommandError::InvalidPath {
            message: "Image has no supported extension".into(),
        })?;
    let probe = PathBuf::from(format!("image.{extension}"));
    if image_mime(&probe).is_none() {
        return Err(CommandError::InvalidPath {
            message: "Supported images are PNG, JPEG, GIF, WebP, and SVG".into(),
        });
    }
    let (directory, directory_name) = asset_directory(&document, preferred_directory)?;
    let stem = safe_image_stem(source_name);
    let target = available_image_path(&directory, &stem, &extension);
    atomic_write(&target, bytes)?;
    Ok(imported_image(&target, &directory_name))
}

#[tauri::command]
pub fn read_image_data_url(document_path: String, source: String) -> Result<String, CommandError> {
    let path = resolve_local_image(&document_path, &source)?;
    let metadata = fs::metadata(&path)?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(CommandError::InvalidPath {
            message: "Images must be 32 MB or smaller".into(),
        });
    }
    let mime = image_mime(&path).unwrap_or("application/octet-stream");
    let bytes = fs::read(path)?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

#[tauri::command]
pub fn import_image_file(
    document_path: String,
    source_path: String,
    preferred_directory: String,
) -> Result<ImportedImage, CommandError> {
    let source = PathBuf::from(source_path)
        .canonicalize()
        .map_err(|_| CommandError::NotFound {
            message: "Selected image was not found".into(),
        })?;
    if image_mime(&source).is_none() {
        return Err(CommandError::InvalidPath {
            message: "Supported images are PNG, JPEG, GIF, WebP, and SVG".into(),
        });
    }
    let metadata = fs::metadata(&source)?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(CommandError::InvalidPath {
            message: "Images must be 32 MB or smaller".into(),
        });
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png");
    let bytes = fs::read(&source)?;
    write_imported_image(&document_path, &bytes, name, &preferred_directory)
}

#[tauri::command]
pub fn import_image_bytes(
    document_path: String,
    bytes: Vec<u8>,
    source_name: String,
    preferred_directory: String,
) -> Result<ImportedImage, CommandError> {
    write_imported_image(&document_path, &bytes, &source_name, &preferred_directory)
}

#[tauri::command]
pub fn trash_image_file(document_path: String, source: String) -> Result<(), CommandError> {
    let path = resolve_local_image(&document_path, &source)?;
    trash::delete(&path).map_err(|error| CommandError::Io {
        message: format!("Unable to move {} to Trash: {error}", path.display()),
    })
}

#[tauri::command]
pub fn read_document(path: String) -> Result<DocumentSnapshot, CommandError> {
    let path = canonical_document_path(&path)?;
    let content = fs::read_to_string(&path)?;
    let metadata = fs::metadata(&path)?;
    Ok(DocumentSnapshot {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md")
            .into(),
        path: path.to_string_lossy().into_owned(),
        content,
        modified_ms: modified_ms(&metadata),
        size: metadata.len(),
    })
}

#[tauri::command]
pub fn document_metadata(path: String) -> Result<DocumentMetadata, CommandError> {
    let path = canonical_document_path(&path)?;
    let metadata = fs::metadata(path)?;
    Ok(DocumentMetadata {
        modified_ms: modified_ms(&metadata),
        size: metadata.len(),
    })
}

#[tauri::command]
pub fn save_document(
    path: String,
    content: String,
    expected_modified_ms: Option<u64>,
    force: bool,
) -> Result<DocumentSnapshot, CommandError> {
    let path = PathBuf::from(path);
    if !is_markdown_path(&path) {
        return Err(CommandError::InvalidPath {
            message: "Documents must use .md or .markdown".into(),
        });
    }

    if path.exists() && !force {
        let metadata = fs::metadata(&path)?;
        let current_modified_ms = modified_ms(&metadata);
        if expected_modified_ms.is_some_and(|expected| expected != current_modified_ms) {
            return Err(CommandError::ExternalChange {
                message: "The file changed outside MarkDownGonzo".into(),
                current_modified_ms,
            });
        }
    }

    atomic_write(&path, content.as_bytes())?;
    read_document(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn load_session() -> Result<Option<Value>, CommandError> {
    let path = state_home()?.join("session.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)?;
    let value = serde_json::from_str(&content).map_err(|error| CommandError::InvalidState {
        message: format!("Invalid session.json: {error}"),
    })?;
    Ok(Some(value))
}

#[tauri::command]
pub fn save_session(session: Value) -> Result<(), CommandError> {
    let path = state_home()?.join("session.json");
    let content =
        serde_json::to_vec_pretty(&session).map_err(|error| CommandError::InvalidState {
            message: error.to_string(),
        })?;
    atomic_write(&path, &content)
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, CommandError> {
    let path = config_home()?.join("config.toml");
    if !path.exists() {
        let config = AppConfig::default();
        let content =
            toml::to_string_pretty(&config).map_err(|error| CommandError::InvalidState {
                message: error.to_string(),
            })?;
        atomic_write(&path, content.as_bytes())?;
        return Ok(config);
    }

    let content = fs::read_to_string(&path)?;
    let mut config: AppConfig =
        toml::from_str(&content).map_err(|error| CommandError::InvalidState {
            message: format!("Invalid config.toml: {error}"),
        })?;
    let mut changed = false;
    if config.fonts.families == ["sans-serif"] && config.editor.font_family == "sans-serif" {
        let defaults = AppConfig::default();
        config.fonts = defaults.fonts;
        config.editor.font_family = defaults.editor.font_family;
        if config.editor.code_font_family == "monospace" {
            config.editor.code_font_family = defaults.editor.code_font_family;
        }
        changed = true;
    }
    for family in &mut config.fonts.families {
        if family == "Nova Mono" {
            *family = "NovaMono".into();
            changed = true;
        }
    }
    if config.editor.font_family == "Nova Mono" {
        config.editor.font_family = "NovaMono".into();
        changed = true;
    }
    if changed {
        let content =
            toml::to_string_pretty(&config).map_err(|error| CommandError::InvalidState {
                message: error.to_string(),
            })?;
        atomic_write(&path, content.as_bytes())?;
    }
    Ok(config)
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<AppConfig, CommandError> {
    let path = config_home()?.join("config.toml");
    let known = toml::Value::try_from(&config).map_err(|error| CommandError::InvalidState {
        message: error.to_string(),
    })?;
    let mut document = fs::read_to_string(&path)
        .ok()
        .and_then(|content| toml::from_str::<toml::Value>(&content).ok())
        .unwrap_or_else(|| toml::Value::Table(Default::default()));
    merge_toml(&mut document, known);
    let content =
        toml::to_string_pretty(&document).map_err(|error| CommandError::InvalidState {
            message: error.to_string(),
        })?;
    atomic_write(&path, content.as_bytes())?;
    Ok(config)
}

fn merge_toml(target: &mut toml::Value, source: toml::Value) {
    match (target, source) {
        (toml::Value::Table(target), toml::Value::Table(source)) => {
            for (key, value) in source {
                if let Some(existing) = target.get_mut(&key) {
                    merge_toml(existing, value);
                } else {
                    target.insert(key, value);
                }
            }
        }
        (target, source) => *target = source,
    }
}

#[tauri::command]
pub fn startup_paths() -> Vec<String> {
    let args: Vec<String> = env::args().collect();
    let cwd = env::current_dir().unwrap_or_default();
    super::markdown_paths(&args, &cwd.to_string_lossy())
}

#[tauri::command]
pub fn open_local_link(
    app: tauri::AppHandle,
    document_path: String,
    target: String,
) -> Result<(), CommandError> {
    let document = canonical_document_path(&document_path)?;
    let target = target.split(['#', '?']).next().unwrap_or_default();
    if target.is_empty() || target.contains("://") {
        return Err(CommandError::InvalidPath {
            message: "Not a local document link".into(),
        });
    }
    let target = PathBuf::from(target);
    let target = if target.is_absolute() {
        target
    } else {
        document.parent().unwrap_or(Path::new("/")).join(target)
    };
    let target = target.canonicalize().map_err(|_| CommandError::NotFound {
        message: format!("Linked file not found: {}", target.display()),
    })?;
    app.opener()
        .open_path(target.to_string_lossy(), None::<&str>)
        .map_err(|error| CommandError::Io {
            message: error.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_markdown_extensions_case_insensitively() {
        assert!(is_markdown_path(Path::new("README.md")));
        assert!(is_markdown_path(Path::new("notes.MARKDOWN")));
        assert!(!is_markdown_path(Path::new("notes.txt")));
    }

    #[test]
    fn default_config_uses_markdowngonzo_font_set() {
        let config = AppConfig::default();
        assert_eq!(config.editor.font_family, "Roboto");
        assert_eq!(config.editor.code_font_family, "Space Mono");
        assert_eq!(config.fonts.families.len(), 7);
        assert_eq!(config.images.directory, "assets");
    }

    #[test]
    fn config_merge_preserves_unknown_keys() {
        let mut target: toml::Value =
            toml::from_str("custom = true\n[editor]\nfont_family = 'Old'\nextra = 7").unwrap();
        let source: toml::Value =
            toml::from_str("[editor]\nfont_family = 'Roboto'\nspellcheck = true").unwrap();
        merge_toml(&mut target, source);
        assert_eq!(target["custom"].as_bool(), Some(true));
        assert_eq!(target["editor"]["extra"].as_integer(), Some(7));
        assert_eq!(target["editor"]["font_family"].as_str(), Some("Roboto"));
    }

    #[test]
    fn imported_images_are_copied_without_overwriting() {
        let directory = env::temp_dir().join(format!(
            "markdowngonzo-image-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        let document = directory.join("note.md");
        fs::write(&document, "# Note").unwrap();

        let first = write_imported_image(
            document.to_str().unwrap(),
            b"first",
            "Photo One.PNG",
            "assets",
        )
        .unwrap();
        let second = write_imported_image(
            document.to_str().unwrap(),
            b"second",
            "Photo One.PNG",
            "assets",
        )
        .unwrap();

        assert_eq!(first.relative_path, "assets/photo-one.png");
        assert_eq!(second.relative_path, "assets/photo-one-2.png");
        assert_eq!(
            fs::read(directory.join(&first.relative_path)).unwrap(),
            b"first"
        );
        assert_eq!(
            fs::read(directory.join(&second.relative_path)).unwrap(),
            b"second"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn atomic_write_replaces_complete_content() {
        let directory = env::temp_dir().join(format!(
            "markdowngonzo-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = directory.join("document.md");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        fs::remove_dir_all(directory).unwrap();
    }
}
