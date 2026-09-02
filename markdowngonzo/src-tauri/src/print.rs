//! Render the current document to a self-contained HTML fragment for printing.
//!
//! Printing uses the webview's own `window.print()` dialog — no external tools,
//! so it works on a Markdown-only install. This command turns the document's
//! Markdown into HTML with the same GitHub-Flavored feature set as export, and
//! inlines local images as `data:` URIs so the printed page needs nothing from
//! disk or the network.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pulldown_cmark::{html, CowStr, Event, Parser, Tag};
use std::fs;

use crate::commands::{image_mime, resolve_local_image, CommandError};
use crate::export::{parser_options, strip_frontmatter};

#[tauri::command]
pub fn render_document_html(
    markdown: String,
    document_path: Option<String>,
) -> Result<String, CommandError> {
    let (body, _title) = strip_frontmatter(&markdown);
    let document_path = document_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());

    let events = Parser::new_ext(body, parser_options()).map(|event| match event {
        Event::Start(Tag::Image {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let dest_url = inline_image(document_path, &dest_url).unwrap_or(dest_url);
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            })
        }
        other => other,
    });

    let mut html = String::new();
    html::push_html(&mut html, events);
    Ok(html)
}

/// Turn a local image reference into a `data:` URI. Remote (`http(s)`) and
/// existing `data:` sources are left alone; anything that fails to resolve keeps
/// its original source so the alt text still shows.
fn inline_image<'a>(document_path: Option<&str>, source: &CowStr<'a>) -> Option<CowStr<'a>> {
    let trimmed = source.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") || trimmed.contains("://") {
        return None;
    }
    let path = resolve_local_image(document_path?, source).ok()?;
    let mime = image_mime(&path)?;
    let bytes = fs::read(&path).ok()?;
    Some(CowStr::from(format!(
        "data:{mime};base64,{}",
        BASE64.encode(bytes)
    )))
}

#[cfg(test)]
mod tests {
    use super::render_document_html;

    #[test]
    fn renders_gfm_to_html() {
        let html = render_document_html(
            "# Title\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n".into(),
            None,
        )
        .unwrap();
        assert!(html.contains("<h1>Title</h1>"));
        assert!(html.contains("<table>"));
        assert!(html.contains("type=\"checkbox\""));
    }

    #[test]
    fn drops_yaml_frontmatter() {
        let html =
            render_document_html("---\ntitle: X\n---\n\nBody text.\n".into(), None).unwrap();
        assert!(html.contains("<p>Body text.</p>"));
        assert!(!html.contains("title: X"));
    }

    #[test]
    fn leaves_remote_images_untouched() {
        let html = render_document_html(
            "![alt](https://example.com/a.png)\n".into(),
            None,
        )
        .unwrap();
        assert!(html.contains("src=\"https://example.com/a.png\""));
    }
}
