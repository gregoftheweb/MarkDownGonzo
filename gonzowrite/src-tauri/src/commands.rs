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
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_family: "sans-serif".into(),
            font_size: 16,
            code_font_family: "monospace".into(),
            code_font_size: 15,
            zoom: 1.0,
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
            families: vec!["sans-serif".into()],
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
            message: "GonzoWrite opens .md and .markdown files".into(),
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
        return Ok(PathBuf::from(path).join("gonzowrite"));
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join(".local/state/gonzowrite"))
        .ok_or_else(|| CommandError::InvalidState {
            message: "Neither XDG_STATE_HOME nor HOME is available".into(),
        })
}

fn config_home() -> Result<PathBuf, CommandError> {
    if let Some(path) = env::var_os("XDG_CONFIG_HOME") {
        return Ok(PathBuf::from(path).join("gonzowrite"));
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join(".config/gonzowrite"))
        .ok_or_else(|| CommandError::InvalidState {
            message: "Neither XDG_CONFIG_HOME nor HOME is available".into(),
        })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
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
        .unwrap_or("gonzowrite");
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
                message: "The file changed outside GonzoWrite".into(),
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

    let content = fs::read_to_string(path)?;
    toml::from_str(&content).map_err(|error| CommandError::InvalidState {
        message: format!("Invalid config.toml: {error}"),
    })
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
    fn default_config_uses_system_font_aliases() {
        let config = AppConfig::default();
        assert_eq!(config.editor.font_family, "sans-serif");
        assert_eq!(config.editor.code_font_family, "monospace");
        assert_eq!(config.images.directory, "assets");
    }

    #[test]
    fn atomic_write_replaces_complete_content() {
        let directory = env::temp_dir().join(format!(
            "gonzowrite-test-{}",
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
