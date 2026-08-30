//! Document export to OpenDocument Text (`.odt`) and PDF.
//!
//! Export is a document feature, not "Save As": the caller passes the source
//! Markdown plus an explicit destination path, and nothing about the open
//! document (its path, dirty state, autosave) changes.
//!
//! - ODT is generated directly in Rust (Markdown -> ODF XML -> zip). No external
//!   tools, works on any install.
//! - PDF is produced by rendering the ODT and handing it to LibreOffice in
//!   headless mode. LibreOffice is an optional dependency: if it is missing the
//!   command fails with an actionable message and ODT export still works.

use std::{
    collections::HashMap,
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use flate2::{write::DeflateEncoder, Compression, Crc};
use pulldown_cmark::{
    Alignment, BlockQuoteKind, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd,
};
use serde::{Deserialize, Serialize};

use crate::commands::{atomic_write, CommandError};

const ODT_MIME: &str = "application/vnd.oasis.opendocument.text";
/// Usable text width on an A4 page with 2 cm margins.
const CONTENT_WIDTH_CM: f64 = 17.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    /// The current document text, exactly as shown in the editor.
    pub markdown: String,
    /// Absolute path the user picked in the save dialog. Extension decides format.
    pub destination: String,
    /// Directory of the source `.md`, used to resolve relative image paths.
    #[serde(default)]
    pub document_dir: Option<String>,
    /// Human-readable title for the document metadata.
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub path: String,
    pub format: String,
}

#[tauri::command]
pub fn export_document(request: ExportRequest) -> Result<ExportOutcome, CommandError> {
    let destination = PathBuf::from(&request.destination);
    let format = destination
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase());

    let base_dir = request
        .document_dir
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_dir());

    let (body, frontmatter_title) = strip_frontmatter(&request.markdown);
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .or(frontmatter_title)
        .unwrap_or_else(|| "Untitled".to_string());

    let odt = markdown_to_odt(body, base_dir.as_deref(), &title)?;

    match format.as_deref() {
        Some("odt") => atomic_write(&destination, &odt)?,
        Some("pdf") => convert_odt_to_pdf(&odt, &destination)?,
        _ => {
            return Err(CommandError::InvalidPath {
                message: "Export destination must end in .odt or .pdf".into(),
            })
        }
    }

    Ok(ExportOutcome {
        path: destination.to_string_lossy().into_owned(),
        format: format.unwrap_or_default(),
    })
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/// Split leading YAML frontmatter from the body, mirroring the frontend's
/// `splitFrontmatter`. Frontmatter is document metadata, not prose, so it is not
/// rendered; a `title:` line, if present, is used for the export metadata.
fn strip_frontmatter(markdown: &str) -> (&str, Option<String>) {
    let Some(rest) = markdown
        .strip_prefix("---\n")
        .or_else(|| markdown.strip_prefix("---\r\n"))
    else {
        return (markdown, None);
    };

    let mut offset = 0;
    let mut title = None;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" || trimmed == "..." {
            return (&rest[offset + line.len()..], title);
        }
        if title.is_none() {
            if let Some(value) = trimmed.strip_prefix("title:") {
                let value = value.trim().trim_matches(['"', '\'']).trim();
                if !value.is_empty() {
                    title = Some(value.to_string());
                }
            }
        }
        offset += line.len();
    }

    // No closing delimiter: treat the whole document as body.
    (markdown, None)
}

// ---------------------------------------------------------------------------
// Markdown -> ODF
// ---------------------------------------------------------------------------

struct Picture {
    name: String,
    media_type: &'static str,
    data: Vec<u8>,
}

fn parser_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_GFM
}

fn markdown_to_odt(
    body: &str,
    base_dir: Option<&Path>,
    title: &str,
) -> Result<Vec<u8>, CommandError> {
    let events: Vec<Event> = Parser::new_ext(body, parser_options()).collect();

    let mut pictures: Vec<Picture> = Vec::new();
    let footnotes = collect_footnotes(&events, base_dir, &mut pictures);

    let mut renderer = Renderer::new(base_dir, &footnotes);
    renderer.run(&events, &mut pictures);
    let content_body = renderer.finish();

    let content_xml = build_content_xml(&content_body);
    let styles_xml = STYLES_XML.to_string();
    let meta_xml = build_meta_xml(title);
    let manifest_xml = build_manifest_xml(&pictures);

    let mut entries = vec![
        ZipEntry::stored("mimetype", ODT_MIME.as_bytes().to_vec()),
        ZipEntry::deflated("META-INF/manifest.xml", manifest_xml.into_bytes()),
        ZipEntry::deflated("content.xml", content_xml.into_bytes()),
        ZipEntry::deflated("styles.xml", styles_xml.into_bytes()),
        ZipEntry::deflated("meta.xml", meta_xml.into_bytes()),
    ];
    for picture in &pictures {
        entries.push(ZipEntry::deflated(
            format!("Pictures/{}", picture.name),
            picture.data.clone(),
        ));
    }

    Ok(build_zip(&entries))
}

#[derive(Clone, Copy, PartialEq)]
enum Ctx {
    Body,
    Quote,
    Item,
    TableCell { head: bool, align: Alignment },
}

struct TableState {
    columns: Vec<Alignment>,
    column: usize,
    in_head: bool,
}

struct ImageAcc {
    url: String,
    alt: String,
}

struct FootnoteMap {
    bodies: HashMap<String, String>,
}

struct Renderer<'a> {
    out: String,
    base_dir: Option<&'a Path>,
    footnotes: &'a FootnoteMap,
    used_footnotes: Vec<String>,
    ctx: Vec<Ctx>,
    para_open: bool,
    list_ordered: Vec<bool>,
    table: Option<TableState>,
    code: Option<String>,
    image: Option<ImageAcc>,
    /// Names of currently open inline HTML spans (`u`, `b`, `i`) to balance.
    html_spans: Vec<&'static str>,
}

impl<'a> Renderer<'a> {
    fn new(base_dir: Option<&'a Path>, footnotes: &'a FootnoteMap) -> Self {
        Self {
            out: String::new(),
            base_dir,
            footnotes,
            used_footnotes: Vec::new(),
            ctx: vec![Ctx::Body],
            para_open: false,
            list_ordered: Vec::new(),
            table: None,
            code: None,
            image: None,
            html_spans: Vec::new(),
        }
    }

    fn top(&self) -> Ctx {
        *self.ctx.last().unwrap_or(&Ctx::Body)
    }

    fn in_quote(&self) -> bool {
        self.ctx.iter().any(|ctx| matches!(ctx, Ctx::Quote))
    }

    fn paragraph_style(&self) -> &'static str {
        match self.top() {
            Ctx::TableCell { head: true, .. } => "Table_20_Heading",
            Ctx::TableCell { head: false, .. } => "Table_20_Contents",
            _ if self.in_quote() => "Quotations",
            _ => "Standard",
        }
    }

    fn ensure_para(&mut self) {
        if self.para_open || self.code.is_some() {
            return;
        }
        let style = self.paragraph_style();
        if let Ctx::TableCell { align, .. } = self.top() {
            if let Some(extra) = alignment_style(align) {
                self.out
                    .push_str(&format!("<text:p text:style-name=\"{extra}\">"));
                self.para_open = true;
                return;
            }
        }
        self.out
            .push_str(&format!("<text:p text:style-name=\"{style}\">"));
        self.para_open = true;
    }

    fn close_para(&mut self) {
        if !self.para_open {
            return;
        }
        for span in self.html_spans.drain(..).rev() {
            let _ = span;
            self.out.push_str("</text:span>");
        }
        self.out.push_str("</text:p>");
        self.para_open = false;
    }

    fn text(&mut self, value: &str) {
        if let Some(image) = self.image.as_mut() {
            image.alt.push_str(value);
            return;
        }
        if let Some(code) = self.code.as_mut() {
            code.push_str(value);
            return;
        }
        self.ensure_para();
        self.out.push_str(&esc(value));
    }

    fn run(&mut self, events: &[Event], pictures: &mut Vec<Picture>) {
        let mut depth_skip: i32 = 0;
        for event in events {
            // Skip footnote-definition subtrees; their bodies are rendered separately.
            if depth_skip > 0 {
                match event {
                    Event::Start(Tag::FootnoteDefinition(_)) => depth_skip += 1,
                    Event::End(TagEnd::FootnoteDefinition) => depth_skip -= 1,
                    _ => {}
                }
                continue;
            }
            match event {
                Event::Start(Tag::FootnoteDefinition(_)) => depth_skip = 1,
                Event::End(TagEnd::FootnoteDefinition) => {}
                other => self.event(other, pictures),
            }
        }
    }

    fn event(&mut self, event: &Event, pictures: &mut Vec<Picture>) {
        match event {
            Event::Start(tag) => self.start(tag, pictures),
            Event::End(tag) => self.end(tag, pictures),
            Event::Text(text) => self.text(text),
            Event::Code(code) => {
                self.ensure_para();
                self.out.push_str(&format!(
                    "<text:span text:style-name=\"Source_20_Text\">{}</text:span>",
                    esc(code)
                ));
            }
            Event::InlineMath(math) => self.text(&format!("${}$", math)),
            Event::DisplayMath(math) => self.text(&format!("$${}$$", math)),
            Event::Html(html) | Event::InlineHtml(html) => self.raw_html(html),
            Event::FootnoteReference(name) => self.footnote_reference(name),
            Event::SoftBreak => self.text(" "),
            Event::HardBreak => {
                if self.code.is_none() {
                    self.ensure_para();
                    self.out.push_str("<text:line-break/>");
                }
            }
            Event::Rule => {
                self.close_para();
                self.out
                    .push_str("<text:p text:style-name=\"Horizontal_20_Line\"/>");
            }
            Event::TaskListMarker(checked) => {
                self.ensure_para();
                self.out
                    .push_str(if *checked { "\u{2611} " } else { "\u{2610} " });
            }
        }
    }

    fn start(&mut self, tag: &Tag, _pictures: &mut Vec<Picture>) {
        match tag {
            Tag::Paragraph => {
                self.close_para();
                self.ensure_para();
            }
            Tag::Heading { level, .. } => {
                self.close_para();
                let n = heading_number(*level);
                self.out.push_str(&format!(
                    "<text:h text:style-name=\"Heading_20_{n}\" text:outline-level=\"{n}\">"
                ));
                self.para_open = true;
            }
            Tag::BlockQuote(kind) => {
                self.close_para();
                self.ctx.push(Ctx::Quote);
                if let Some(kind) = kind {
                    self.out.push_str(&format!(
                        "<text:p text:style-name=\"Quotations\"><text:span text:style-name=\"Strong_20_Emphasis\">{}</text:span></text:p>",
                        blockquote_label(kind)
                    ));
                }
            }
            Tag::CodeBlock(kind) => {
                self.close_para();
                let _ = match kind {
                    CodeBlockKind::Fenced(lang) => lang.to_string(),
                    CodeBlockKind::Indented => String::new(),
                };
                self.code = Some(String::new());
            }
            Tag::HtmlBlock => {}
            Tag::List(first) => {
                self.close_para();
                let ordered = first.is_some();
                self.list_ordered.push(ordered);
                let style = if ordered { "L-Number" } else { "L-Bullet" };
                self.out
                    .push_str(&format!("<text:list text:style-name=\"{style}\">"));
            }
            Tag::Item => {
                self.out.push_str("<text:list-item>");
                self.ctx.push(Ctx::Item);
            }
            Tag::FootnoteDefinition(_) => {}
            // Definition lists are not enabled in `parser_options`, so these
            // tags never appear; handle them plainly in case that changes.
            Tag::DefinitionList => {}
            Tag::DefinitionListTitle => {
                self.close_para();
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Strong_20_Emphasis\">");
            }
            Tag::DefinitionListDefinition => {
                self.close_para();
                self.ctx.push(Ctx::Quote);
            }
            Tag::Table(alignments) => {
                self.close_para();
                self.table = Some(TableState {
                    columns: alignments.clone(),
                    column: 0,
                    in_head: false,
                });
                let columns = alignments.len().max(1);
                self.out.push_str(
                    "<table:table table:style-name=\"MdgTable\"><table:table-column \
                     table:style-name=\"MdgTable.Col\" table:number-columns-repeated=\"",
                );
                self.out.push_str(&columns.to_string());
                self.out.push_str("\"/>");
            }
            Tag::TableHead => {
                if let Some(table) = self.table.as_mut() {
                    table.in_head = true;
                    table.column = 0;
                }
                self.out
                    .push_str("<table:table-header-rows><table:table-row>");
            }
            Tag::TableRow => {
                if let Some(table) = self.table.as_mut() {
                    table.column = 0;
                }
                self.out.push_str("<table:table-row>");
            }
            Tag::TableCell => {
                let (head, align) = self
                    .table
                    .as_ref()
                    .map(|table| {
                        (
                            table.in_head,
                            table
                                .columns
                                .get(table.column)
                                .copied()
                                .unwrap_or(Alignment::None),
                        )
                    })
                    .unwrap_or((false, Alignment::None));
                self.out.push_str(
                    "<table:table-cell table:style-name=\"MdgTable.Cell\" office:value-type=\"string\">",
                );
                self.ctx.push(Ctx::TableCell { head, align });
                self.ensure_para();
            }
            Tag::Emphasis => {
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Emphasis\">");
            }
            Tag::Strong => {
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Strong_20_Emphasis\">");
            }
            Tag::Strikethrough => {
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Strikethrough\">");
            }
            Tag::Superscript => {
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Superscript\">");
            }
            Tag::Subscript => {
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Subscript\">");
            }
            Tag::Link { dest_url, .. } => {
                self.ensure_para();
                self.out.push_str(&format!(
                    "<text:a xlink:type=\"simple\" xlink:href=\"{}\" text:style-name=\"Internet_20_Link\">",
                    esc(dest_url)
                ));
            }
            Tag::Image { dest_url, .. } => {
                self.image = Some(ImageAcc {
                    url: dest_url.to_string(),
                    alt: String::new(),
                });
            }
            Tag::MetadataBlock(_) => {}
        }
    }

    fn end(&mut self, tag: &TagEnd, pictures: &mut Vec<Picture>) {
        match tag {
            TagEnd::Paragraph => self.close_para(),
            TagEnd::Heading(_) => {
                self.out.push_str("</text:h>");
                self.para_open = false;
            }
            TagEnd::BlockQuote(_) => {
                self.close_para();
                self.pop_ctx(Ctx::Quote);
            }
            TagEnd::CodeBlock => {
                let code = self.code.take().unwrap_or_default();
                let trimmed = code.strip_suffix('\n').unwrap_or(&code);
                if trimmed.is_empty() {
                    self.out
                        .push_str("<text:p text:style-name=\"Preformatted_20_Text\"/>");
                } else {
                    for line in trimmed.split('\n') {
                        self.out
                            .push_str("<text:p text:style-name=\"Preformatted_20_Text\">");
                        push_preserving_spaces(&mut self.out, line);
                        self.out.push_str("</text:p>");
                    }
                }
            }
            TagEnd::HtmlBlock => {}
            TagEnd::List(_) => {
                self.list_ordered.pop();
                self.out.push_str("</text:list>");
            }
            TagEnd::Item => {
                self.close_para();
                self.pop_ctx(Ctx::Item);
                self.out.push_str("</text:list-item>");
            }
            TagEnd::FootnoteDefinition => {}
            TagEnd::DefinitionList => {}
            TagEnd::DefinitionListTitle => {
                self.out.push_str("</text:span>");
                self.close_para();
            }
            TagEnd::DefinitionListDefinition => {
                self.close_para();
                self.pop_ctx(Ctx::Quote);
            }
            TagEnd::Table => {
                self.out.push_str("</table:table>");
                self.table = None;
            }
            TagEnd::TableHead => {
                self.out
                    .push_str("</table:table-row></table:table-header-rows>");
                if let Some(table) = self.table.as_mut() {
                    table.in_head = false;
                }
            }
            TagEnd::TableRow => self.out.push_str("</table:table-row>"),
            TagEnd::TableCell => {
                self.close_para();
                if let Some(Ctx::TableCell { .. }) = self.ctx.last() {
                    self.ctx.pop();
                }
                self.out.push_str("</table:table-cell>");
                if let Some(table) = self.table.as_mut() {
                    table.column += 1;
                }
            }
            TagEnd::Emphasis
            | TagEnd::Strong
            | TagEnd::Strikethrough
            | TagEnd::Superscript
            | TagEnd::Subscript => self.out.push_str("</text:span>"),
            TagEnd::Link => self.out.push_str("</text:a>"),
            TagEnd::Image => {
                if let Some(image) = self.image.take() {
                    self.emit_image(image, pictures);
                }
            }
            TagEnd::MetadataBlock(_) => {}
        }
    }

    fn pop_ctx(&mut self, kind: Ctx) {
        if self.ctx.last() == Some(&kind) {
            self.ctx.pop();
        }
    }

    fn raw_html(&mut self, html: &str) {
        let lowered = html.trim().to_ascii_lowercase();
        let simple = lowered.replace(char::is_whitespace, "");
        match simple.as_str() {
            "<u>" => {
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Underline\">");
                self.html_spans.push("u");
            }
            "</u>" => self.close_html_span("u"),
            "<b>" | "<strong>" => {
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Strong_20_Emphasis\">");
                self.html_spans.push("b");
            }
            "</b>" | "</strong>" => self.close_html_span("b"),
            "<i>" | "<em>" => {
                self.ensure_para();
                self.out
                    .push_str("<text:span text:style-name=\"Emphasis\">");
                self.html_spans.push("i");
            }
            "</i>" | "</em>" => self.close_html_span("i"),
            "<br>" | "<br/>" => {
                if self.code.is_none() {
                    self.ensure_para();
                    self.out.push_str("<text:line-break/>");
                }
            }
            _ if lowered.starts_with("<!--") => {}
            _ => {
                // Unknown markup: keep any visible text, drop the tags.
                let stripped = strip_tags(html);
                if !stripped.trim().is_empty() {
                    self.text(&stripped);
                }
            }
        }
    }

    fn close_html_span(&mut self, name: &'static str) {
        if let Some(position) = self.html_spans.iter().rposition(|span| *span == name) {
            self.html_spans.remove(position);
            self.out.push_str("</text:span>");
        }
    }

    fn footnote_reference(&mut self, name: &str) {
        self.ensure_para();
        let number = match self.used_footnotes.iter().position(|used| used == name) {
            Some(index) => index + 1,
            None => {
                self.used_footnotes.push(name.to_string());
                self.used_footnotes.len()
            }
        };
        let body = self
            .footnotes
            .bodies
            .get(name)
            .cloned()
            .unwrap_or_else(|| format!("<text:p text:style-name=\"Footnote\">{}</text:p>", esc(name)));
        self.out.push_str(&format!(
            "<text:note text:id=\"ftn{number}\" text:note-class=\"footnote\">\
             <text:note-citation>{number}</text:note-citation>\
             <text:note-body>{body}</text:note-body></text:note>"
        ));
    }

    fn emit_image(&mut self, image: ImageAcc, pictures: &mut Vec<Picture>) {
        self.ensure_para();
        let alt = image.alt.trim();
        match load_image(self.base_dir, &image.url) {
            Some(loaded) => {
                let number = pictures.len() + 1;
                let name = format!("image{}.{}", number, loaded.extension);
                let (width_cm, height_cm) = fit_dimensions(loaded.width, loaded.height);
                let desc = if alt.is_empty() {
                    String::new()
                } else {
                    format!("<svg:desc>{}</svg:desc>", esc(alt))
                };
                self.out.push_str(&format!(
                    "<draw:frame draw:style-name=\"MdgFrame\" draw:name=\"Image{number}\" \
                     text:anchor-type=\"as-char\" svg:width=\"{width_cm:.3}cm\" \
                     svg:height=\"{height_cm:.3}cm\" draw:z-index=\"0\">\
                     <draw:image xlink:href=\"Pictures/{name}\" xlink:type=\"simple\" \
                     xlink:show=\"embed\" xlink:actuate=\"onLoad\" draw:mime-type=\"{mime}\"/>\
                     {desc}</draw:frame>",
                    mime = loaded.media_type,
                ));
                pictures.push(Picture {
                    name,
                    media_type: loaded.media_type,
                    data: loaded.data,
                });
            }
            None => {
                // Remote or missing image: keep the alt text so nothing is lost.
                let label = if alt.is_empty() { "image" } else { alt };
                self.out.push_str(&format!(
                    "<text:span text:style-name=\"Emphasis\">[{}]</text:span>",
                    esc(label)
                ));
            }
        }
    }

    fn finish(mut self) -> String {
        self.close_para();
        self.out
    }
}

fn collect_footnotes(
    events: &[Event],
    base_dir: Option<&Path>,
    pictures: &mut Vec<Picture>,
) -> FootnoteMap {
    let empty = FootnoteMap {
        bodies: HashMap::new(),
    };
    let mut map = FootnoteMap {
        bodies: HashMap::new(),
    };

    let mut index = 0;
    while index < events.len() {
        if let Event::Start(Tag::FootnoteDefinition(name)) = &events[index] {
            let mut depth = 1;
            let start = index + 1;
            let mut end = start;
            while end < events.len() && depth > 0 {
                match &events[end] {
                    Event::Start(Tag::FootnoteDefinition(_)) => depth += 1,
                    Event::End(TagEnd::FootnoteDefinition) => depth -= 1,
                    _ => {}
                }
                if depth > 0 {
                    end += 1;
                }
            }
            let mut renderer = Renderer::new(base_dir, &empty);
            renderer.run(&events[start..end], pictures);
            let body = renderer.finish();
            let body = if body.trim().is_empty() {
                "<text:p text:style-name=\"Footnote\"/>".to_string()
            } else {
                body
            };
            map.bodies.insert(name.to_string(), body);
            index = end + 1;
        } else {
            index += 1;
        }
    }

    map
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn esc(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for character in value.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\t' => out.push_str("&#9;"),
            '\n' => out.push('\n'),
            character if (character as u32) < 0x20 => {}
            character => out.push(character),
        }
    }
    out
}

fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for character in html.chars() {
        match character {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(character),
            _ => {}
        }
    }
    out
}

/// Encode a code line so ODF keeps every space and tab.
fn push_preserving_spaces(out: &mut String, line: &str) {
    let mut spaces = 0usize;
    let flush = |out: &mut String, spaces: &mut usize| {
        if *spaces == 1 {
            out.push(' ');
        } else if *spaces > 1 {
            out.push_str(&format!("<text:s text:c=\"{}\"/>", spaces));
        }
        *spaces = 0;
    };
    for character in line.chars() {
        match character {
            ' ' => spaces += 1,
            '\t' => {
                flush(out, &mut spaces);
                out.push_str("<text:tab/>");
            }
            other => {
                flush(out, &mut spaces);
                out.push_str(&esc(&other.to_string()));
            }
        }
    }
    flush(out, &mut spaces);
}

fn heading_number(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn blockquote_label(kind: &BlockQuoteKind) -> &'static str {
    match kind {
        BlockQuoteKind::Note => "Note",
        BlockQuoteKind::Tip => "Tip",
        BlockQuoteKind::Important => "Important",
        BlockQuoteKind::Warning => "Warning",
        BlockQuoteKind::Caution => "Caution",
    }
}

fn alignment_style(alignment: Alignment) -> Option<&'static str> {
    match alignment {
        Alignment::Center => Some("MdgCellCenter"),
        Alignment::Right => Some("MdgCellRight"),
        _ => None,
    }
}

struct LoadedImage {
    data: Vec<u8>,
    media_type: &'static str,
    extension: &'static str,
    width: u32,
    height: u32,
}

fn load_image(base_dir: Option<&Path>, url: &str) -> Option<LoadedImage> {
    let cleaned = url.trim().trim_matches(['<', '>']);
    if cleaned.starts_with("data:") || cleaned.contains("://") {
        return None;
    }
    let without_fragment = cleaned.split(['#', '?']).next().unwrap_or_default();
    let decoded = percent_encoding::percent_decode_str(without_fragment)
        .decode_utf8()
        .ok()?;
    let path = PathBuf::from(decoded.as_ref());
    let path = if path.is_absolute() {
        path
    } else {
        base_dir?.join(path)
    };
    let path = path.canonicalize().ok()?;
    if !path.is_file() {
        return None;
    }
    let data = fs::read(&path).ok()?;
    if data.is_empty() || data.len() > 64 * 1024 * 1024 {
        return None;
    }

    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase());
    let (media_type, ext): (&'static str, &'static str) = match extension.as_deref() {
        Some("png") => ("image/png", "png"),
        Some("jpg") | Some("jpeg") => ("image/jpeg", "jpg"),
        Some("gif") => ("image/gif", "gif"),
        Some("webp") => ("image/webp", "webp"),
        Some("svg") => ("image/svg+xml", "svg"),
        _ => sniff_image(&data)?,
    };

    let (width, height) = image_dimensions(&data).unwrap_or((600, 400));
    Some(LoadedImage {
        data,
        media_type,
        extension: ext,
        width,
        height,
    })
}

fn sniff_image(data: &[u8]) -> Option<(&'static str, &'static str)> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if data.starts_with(b"\xFF\xD8\xFF") {
        Some(("image/jpeg", "jpg"))
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else if data.starts_with(b"<?xml") || data.starts_with(b"<svg") {
        Some(("image/svg+xml", "svg"))
    } else {
        None
    }
}

fn image_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") && data.len() >= 24 {
        let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
        return non_zero(width, height);
    }
    if (data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a")) && data.len() >= 10 {
        let width = u16::from_le_bytes([data[6], data[7]]) as u32;
        let height = u16::from_le_bytes([data[8], data[9]]) as u32;
        return non_zero(width, height);
    }
    if data.starts_with(b"\xFF\xD8") {
        return jpeg_dimensions(data);
    }
    if data.len() > 30 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return webp_dimensions(data);
    }
    if data.starts_with(b"<?xml") || data.starts_with(b"<svg") {
        return svg_dimensions(data);
    }
    None
}

fn non_zero(width: u32, height: u32) -> Option<(u32, u32)> {
    if width > 0 && height > 0 {
        Some((width, height))
    } else {
        None
    }
}

fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let mut index = 2;
    while index + 9 < data.len() {
        if data[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = data[index + 1];
        if marker == 0xD8 || marker == 0xD9 {
            index += 2;
            continue;
        }
        let length = u16::from_be_bytes([data[index + 2], data[index + 3]]) as usize;
        let is_sof = matches!(
            marker,
            0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE
                | 0xCF
        );
        if is_sof && index + 9 < data.len() {
            let height = u16::from_be_bytes([data[index + 5], data[index + 6]]) as u32;
            let width = u16::from_be_bytes([data[index + 7], data[index + 8]]) as u32;
            return non_zero(width, height);
        }
        if marker == 0xDA {
            break;
        }
        index += 2 + length;
    }
    None
}

fn webp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let fourcc = &data[12..16];
    match fourcc {
        b"VP8X" if data.len() >= 30 => {
            let width = 1 + (u32::from(data[24]) | (u32::from(data[25]) << 8) | (u32::from(data[26]) << 16));
            let height = 1 + (u32::from(data[27]) | (u32::from(data[28]) << 8) | (u32::from(data[29]) << 16));
            non_zero(width, height)
        }
        b"VP8 " if data.len() >= 30 => {
            let width = u16::from_le_bytes([data[26], data[27]]) as u32 & 0x3FFF;
            let height = u16::from_le_bytes([data[28], data[29]]) as u32 & 0x3FFF;
            non_zero(width, height)
        }
        _ => None,
    }
}

fn svg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let head = String::from_utf8_lossy(&data[..data.len().min(2048)]);
    let dimension = |attribute: &str| -> Option<f64> {
        let start = head.find(&format!("{attribute}="))? + attribute.len() + 1;
        let rest = &head[start..];
        let quote = rest.chars().next()?;
        let end = rest[1..].find(quote)? + 1;
        let raw = &rest[1..end];
        let number: String = raw
            .chars()
            .take_while(|character| character.is_ascii_digit() || *character == '.')
            .collect();
        number.parse().ok()
    };
    if let (Some(width), Some(height)) = (dimension("width"), dimension("height")) {
        return non_zero(width as u32, height as u32);
    }
    if let Some(start) = head.find("viewBox=") {
        let rest = &head[start + 8..];
        let quote = rest.chars().next()?;
        let end = rest[1..].find(quote)? + 1;
        let parts: Vec<f64> = rest[1..end]
            .split([' ', ','])
            .filter_map(|part| part.trim().parse().ok())
            .collect();
        if parts.len() == 4 {
            return non_zero(parts[2] as u32, parts[3] as u32);
        }
    }
    None
}

fn fit_dimensions(width: u32, height: u32) -> (f64, f64) {
    let width_cm = width as f64 * 2.54 / 96.0;
    let height_cm = height as f64 * 2.54 / 96.0;
    if width_cm > CONTENT_WIDTH_CM {
        let scale = CONTENT_WIDTH_CM / width_cm;
        (CONTENT_WIDTH_CM, height_cm * scale)
    } else {
        (width_cm, height_cm)
    }
}

// ---------------------------------------------------------------------------
// ODF documents
// ---------------------------------------------------------------------------

const CONTENT_NAMESPACES: &str = concat!(
    " xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\"",
    " xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\"",
    " xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\"",
    " xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\"",
    " xmlns:draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\"",
    " xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\"",
    " xmlns:xlink=\"http://www.w3.org/1999/xlink\"",
    " xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\"",
    " xmlns:meta=\"urn:oasis:names:tc:opendocument:xmlns:meta:1.0\"",
    " xmlns:dc=\"http://purl.org/dc/elements/1.1/\"",
);

fn build_content_xml(body: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <office:document-content{namespaces} office:version=\"1.3\">\
         <office:scripts/>\
         <office:font-face-decls>\
         <style:font-face style:name=\"Body\" svg:font-family=\"'Liberation Sans','Arial',sans-serif\" style:font-family-generic=\"swiss\"/>\
         <style:font-face style:name=\"Mono\" svg:font-family=\"'Liberation Mono','DejaVu Sans Mono',monospace\" style:font-family-generic=\"modern\" style:font-pitch=\"fixed\"/>\
         </office:font-face-decls>\
         <office:automatic-styles>\
         <style:style style:name=\"MdgTable\" style:family=\"table\">\
         <style:table-properties style:width=\"17cm\" table:align=\"margins\" fo:margin-top=\"0.2cm\" fo:margin-bottom=\"0.2cm\"/>\
         </style:style>\
         <style:style style:name=\"MdgTable.Col\" style:family=\"table-column\">\
         <style:table-column-properties style:use-optimal-column-width=\"true\"/>\
         </style:style>\
         <style:style style:name=\"MdgTable.Cell\" style:family=\"table-cell\">\
         <style:table-cell-properties fo:border=\"0.5pt solid #9aa0a6\" fo:padding=\"0.12cm\"/>\
         </style:style>\
         <style:style style:name=\"MdgCellCenter\" style:family=\"paragraph\" style:parent-style-name=\"Table_20_Contents\">\
         <style:paragraph-properties fo:text-align=\"center\"/></style:style>\
         <style:style style:name=\"MdgCellRight\" style:family=\"paragraph\" style:parent-style-name=\"Table_20_Contents\">\
         <style:paragraph-properties fo:text-align=\"end\"/></style:style>\
         <style:style style:name=\"MdgFrame\" style:family=\"graphic\" style:parent-style-name=\"Graphics\">\
         <style:graphic-properties style:wrap=\"none\" style:vertical-pos=\"top\" style:horizontal-pos=\"center\" fo:margin-top=\"0.1cm\" fo:margin-bottom=\"0.1cm\"/>\
         </style:style>\
         </office:automatic-styles>\
         <office:body><office:text>{body}</office:text></office:body>\
         </office:document-content>",
        namespaces = CONTENT_NAMESPACES,
        body = body,
    )
}

fn build_meta_xml(title: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <office:document-meta{namespaces} office:version=\"1.3\">\
         <office:meta>\
         <meta:generator>MarkDownGonzo</meta:generator>\
         <dc:title>{title}</dc:title>\
         </office:meta></office:document-meta>",
        namespaces = CONTENT_NAMESPACES,
        title = esc(title),
    )
}

fn build_manifest_xml(pictures: &[Picture]) -> String {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.3\">\
         <manifest:file-entry manifest:full-path=\"/\" manifest:version=\"1.3\" manifest:media-type=\"application/vnd.oasis.opendocument.text\"/>\
         <manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"styles.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"meta.xml\" manifest:media-type=\"text/xml\"/>",
    );
    for picture in pictures {
        out.push_str(&format!(
            "<manifest:file-entry manifest:full-path=\"Pictures/{}\" manifest:media-type=\"{}\"/>",
            picture.name, picture.media_type
        ));
    }
    out.push_str("</manifest:manifest>");
    out
}

const STYLES_XML: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3">
<office:font-face-decls>
<style:font-face style:name="Body" svg:font-family="'Liberation Sans','Arial',sans-serif" style:font-family-generic="swiss"/>
<style:font-face style:name="Mono" svg:font-family="'Liberation Mono','DejaVu Sans Mono',monospace" style:font-family-generic="modern" style:font-pitch="fixed"/>
</office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph">
<style:text-properties style:font-name="Body" fo:font-size="11pt" fo:language="en" fo:country="US"/>
</style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text">
<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.25cm" fo:line-height="115%"/>
</style:style>
<style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text"/>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_20_body" style:class="text">
<style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"/>
<style:text-properties style:font-name="Body" fo:font-weight="bold"/>
</style:style>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="1" style:class="text">
<style:text-properties fo:font-size="22pt" fo:font-weight="bold"/>
</style:style>
<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="2" style:class="text">
<style:text-properties fo:font-size="17pt" fo:font-weight="bold"/>
</style:style>
<style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="3" style:class="text">
<style:text-properties fo:font-size="14pt" fo:font-weight="bold"/>
</style:style>
<style:style style:name="Heading_20_4" style:display-name="Heading 4" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="4" style:class="text">
<style:text-properties fo:font-size="12pt" fo:font-weight="bold" fo:font-style="italic"/>
</style:style>
<style:style style:name="Heading_20_5" style:display-name="Heading 5" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="5" style:class="text">
<style:text-properties fo:font-size="11pt" fo:font-weight="bold"/>
</style:style>
<style:style style:name="Heading_20_6" style:display-name="Heading 6" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="6" style:class="text">
<style:text-properties fo:font-size="11pt" fo:font-weight="bold" fo:font-style="italic"/>
</style:style>
<style:style style:name="Quotations" style:display-name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html">
<style:paragraph-properties fo:margin-left="1cm" fo:margin-right="0.5cm" fo:margin-top="0.15cm" fo:margin-bottom="0.15cm" fo:border-left="0.1cm solid #c0c0c0" fo:padding-left="0.4cm"/>
<style:text-properties fo:font-style="italic"/>
</style:style>
<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html">
<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:background-color="#f4f4f4" fo:padding="0.05cm 0.2cm" fo:border="0.02cm solid #dddddd" style:join-border="false"/>
<style:text-properties style:font-name="Mono" fo:font-size="9.5pt"/>
</style:style>
<style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard" style:class="list"/>
<style:style style:name="Footnote" style:display-name="Footnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
<style:paragraph-properties fo:margin-left="0.3cm" fo:text-indent="-0.3cm" fo:margin-bottom="0cm"/>
<style:text-properties fo:font-size="9pt"/>
</style:style>
<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm"/>
</style:style>
<style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents" style:class="extra">
<style:paragraph-properties fo:text-align="center"/>
<style:text-properties fo:font-weight="bold"/>
</style:style>
<style:style style:name="Horizontal_20_Line" style:display-name="Horizontal Line" style:family="paragraph" style:parent-style-name="Standard" style:class="html">
<style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.4cm" fo:padding="0cm" fo:border-left="none" fo:border-right="none" fo:border-top="none" fo:border-bottom="1.1pt double #808080"/>
</style:style>
<style:style style:name="Emphasis" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Strong_20_Emphasis" style:display-name="Strong Emphasis" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Strikethrough" style:family="text"><style:text-properties style:text-line-through-style="solid" style:text-line-through-type="single"/></style:style>
<style:style style:name="Underline" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>
<style:style style:name="Superscript" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
<style:style style:name="Subscript" style:family="text"><style:text-properties style:text-position="sub 58%"/></style:style>
<style:style style:name="Source_20_Text" style:display-name="Source Text" style:family="text"><style:text-properties style:font-name="Mono" fo:font-size="9.5pt" fo:background-color="#f0f0f0"/></style:style>
<style:style style:name="Internet_20_Link" style:display-name="Internet Link" style:family="text"><style:text-properties fo:color="#1155cc" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>
<text:notes-configuration text:note-class="footnote" text:citation-style-name="Footnote_20_Symbol" text:citation-body-style-name="Footnote_20_anchor" text:default-style-name="Footnote" text:master-page-name="Footnote" text:start-value="0" text:footnotes-position="page" text:start-numbering-at="document"/>
<text:list-style style:name="L-Bullet">
<text:list-level-style-bullet text:level="1" text:bullet-char="&#8226;"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment" fo:margin-left="0.635cm" fo:text-indent="-0.635cm"/></text:list-level-style-bullet>
<text:list-level-style-bullet text:level="2" text:bullet-char="&#9702;"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment" fo:margin-left="1.27cm" fo:text-indent="-0.635cm"/></text:list-level-style-bullet>
<text:list-level-style-bullet text:level="3" text:bullet-char="&#9642;"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment" fo:margin-left="1.905cm" fo:text-indent="-0.635cm"/></text:list-level-style-bullet>
<text:list-level-style-bullet text:level="4" text:bullet-char="&#8226;"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment" fo:margin-left="2.54cm" fo:text-indent="-0.635cm"/></text:list-level-style-bullet>
</text:list-style>
<text:list-style style:name="L-Number">
<text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment" fo:margin-left="0.635cm" fo:text-indent="-0.635cm"/></text:list-level-style-number>
<text:list-level-style-number text:level="2" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment" fo:margin-left="1.27cm" fo:text-indent="-0.635cm"/></text:list-level-style-number>
<text:list-level-style-number text:level="3" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment" fo:margin-left="1.905cm" fo:text-indent="-0.635cm"/></text:list-level-style-number>
<text:list-level-style-number text:level="4" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment" fo:margin-left="2.54cm" fo:text-indent="-0.635cm"/></text:list-level-style-number>
</text:list-style>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="Mpm1">
<style:page-layout-properties fo:page-width="21.001cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm" style:writing-mode="lr-tb"/>
</style:page-layout>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Standard" style:page-layout-name="Mpm1"/>
</office:master-styles>
</office:document-styles>
"##;

// ---------------------------------------------------------------------------
// Minimal ZIP writer (store + deflate), enough for the ODF package
// ---------------------------------------------------------------------------

struct ZipEntry {
    name: String,
    data: Vec<u8>,
    stored: bool,
}

impl ZipEntry {
    fn stored(name: impl Into<String>, data: Vec<u8>) -> Self {
        Self {
            name: name.into(),
            data,
            stored: true,
        }
    }
    fn deflated(name: impl Into<String>, data: Vec<u8>) -> Self {
        Self {
            name: name.into(),
            data,
            stored: false,
        }
    }
}

fn build_zip(entries: &[ZipEntry]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    // DOS timestamp for 1980-01-01 00:00:00.
    let dos_time: u16 = 0;
    let dos_date: u16 = 0x0021;

    for entry in entries {
        let mut crc = Crc::new();
        crc.update(&entry.data);
        let checksum = crc.sum();

        let (method, payload): (u16, Vec<u8>) = if entry.stored {
            (0, entry.data.clone())
        } else {
            let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
            encoder
                .write_all(&entry.data)
                .and_then(|_| encoder.finish())
                .map(|compressed| (8u16, compressed))
                .unwrap_or_else(|_| (0, entry.data.clone()))
        };

        let name = entry.name.as_bytes();
        let local_offset = out.len() as u32;

        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&dos_time.to_le_bytes());
        out.extend_from_slice(&dos_date.to_le_bytes());
        out.extend_from_slice(&checksum.to_le_bytes());
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(&(entry.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name);
        out.extend_from_slice(&payload);

        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&0x031Eu16.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&method.to_le_bytes());
        central.extend_from_slice(&dos_time.to_le_bytes());
        central.extend_from_slice(&dos_date.to_le_bytes());
        central.extend_from_slice(&checksum.to_le_bytes());
        central.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        central.extend_from_slice(&(entry.data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u32.to_le_bytes());
        central.extend_from_slice(&local_offset.to_le_bytes());
        central.extend_from_slice(name);
    }

    let central_offset = out.len() as u32;
    let central_size = central.len() as u32;
    out.extend_from_slice(&central);

    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&central_size.to_le_bytes());
    out.extend_from_slice(&central_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());

    out
}

// ---------------------------------------------------------------------------
// PDF via LibreOffice
// ---------------------------------------------------------------------------

fn convert_odt_to_pdf(odt: &[u8], destination: &Path) -> Result<(), CommandError> {
    let soffice = libreoffice_binary().ok_or_else(|| CommandError::DependencyMissing {
        tool: "libreoffice".into(),
        message: "Dude, MarkDownGonzo uses LibreOffice to transmogrify into a PDF. \
                  So\u{2026} if you want a PDF you\u{2019}re gonna need LibreOffice. \
                  Install it (Arch: sudo pacman -S libreoffice-fresh) — or export to \
                  ODT instead, which needs nothing."
            .into(),
    })?;

    let work = unique_temp_dir("markdowngonzo-pdf")?;
    let cleanup = TempDir(work.clone());
    let profile = work.join("profile");
    let source = work.join("export.odt");
    let produced = work.join("export.pdf");
    fs::write(&source, odt)?;

    let mut command = Command::new(&soffice);
    command
        .arg("--headless")
        .arg("--nologo")
        .arg("--nolockcheck")
        .arg("--norestore")
        .arg("--nodefault")
        .arg(format!(
            "-env:UserInstallation=file://{}",
            profile.to_string_lossy()
        ))
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(&work)
        .arg(&source)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let status = run_with_timeout(command, Duration::from_secs(120))?;
    if !status {
        return Err(CommandError::Io {
            message: "LibreOffice could not convert the document to PDF.".into(),
        });
    }
    if !produced.is_file() {
        return Err(CommandError::Io {
            message: "LibreOffice finished but produced no PDF file.".into(),
        });
    }

    let bytes = fs::read(&produced)?;
    atomic_write(destination, &bytes)?;
    drop(cleanup);
    Ok(())
}

fn libreoffice_binary() -> Option<PathBuf> {
    let names = ["soffice", "libreoffice"];
    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            for name in names {
                let candidate = directory.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    for fallback in [
        "/usr/bin/soffice",
        "/usr/lib/libreoffice/program/soffice",
        "/opt/libreoffice/program/soffice",
        "/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice",
    ] {
        let path = PathBuf::from(fallback);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn run_with_timeout(mut command: Command, timeout: Duration) -> Result<bool, CommandError> {
    let mut child = command.spawn().map_err(|error| CommandError::Io {
        message: format!("Unable to start LibreOffice: {error}"),
    })?;
    let start = Instant::now();
    loop {
        match child.try_wait()? {
            Some(status) => return Ok(status.success()),
            None => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(CommandError::Io {
                        message: "LibreOffice timed out while creating the PDF.".into(),
                    });
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

fn unique_temp_dir(prefix: &str) -> Result<PathBuf, CommandError> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = env::temp_dir().join(format!("{prefix}-{stamp}-{}", std::process::id()));
    fs::create_dir_all(&path)?;
    Ok(path)
}

struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(markdown: &str) -> String {
        let (body, _) = strip_frontmatter(markdown);
        let events: Vec<Event> = Parser::new_ext(body, parser_options()).collect();
        let mut pictures = Vec::new();
        let footnotes = collect_footnotes(&events, None, &mut pictures);
        let mut renderer = Renderer::new(None, &footnotes);
        renderer.run(&events, &mut pictures);
        renderer.finish()
    }

    #[test]
    fn headings_and_inline_marks() {
        let xml = render("## Sub *heading*\n\nA **bold** and ~~gone~~ and `code`.\n");
        assert!(xml.contains(
            "<text:h text:style-name=\"Heading_20_2\" text:outline-level=\"2\">Sub <text:span text:style-name=\"Emphasis\">heading</text:span></text:h>"
        ));
        assert!(xml.contains("<text:span text:style-name=\"Strong_20_Emphasis\">bold</text:span>"));
        assert!(xml.contains("<text:span text:style-name=\"Strikethrough\">gone</text:span>"));
        assert!(xml.contains("<text:span text:style-name=\"Source_20_Text\">code</text:span>"));
    }

    #[test]
    fn links_and_xml_escaping() {
        let xml = render("See [A & B](https://example.com/x?a=1&b=2). Also 2 < 3 & 5 > 4.\n");
        assert!(xml.contains("xlink:href=\"https://example.com/x?a=1&amp;b=2\""));
        assert!(xml.contains("A &amp; B"));
        assert!(xml.contains("2 &lt; 3 &amp; 5 &gt; 4"));
    }

    #[test]
    fn nested_lists_and_tasks() {
        let xml = render("- one\n  - nested\n- [x] done\n- [ ] todo\n");
        assert!(xml.contains("<text:list text:style-name=\"L-Bullet\"><text:list-item>"));
        assert!(xml.matches("<text:list text:style-name=\"L-Bullet\">").count() >= 2);
        assert!(xml.contains("\u{2611} done"));
        assert!(xml.contains("\u{2610} todo"));
    }

    #[test]
    fn ordered_list() {
        let xml = render("1. first\n2. second\n");
        assert!(xml.contains("<text:list text:style-name=\"L-Number\">"));
    }

    #[test]
    fn tables_with_header_and_alignment() {
        let xml = render("| Name | Score |\n| :--- | ---: |\n| Gonzo | 9 |\n");
        assert!(xml.contains("<table:table table:style-name=\"MdgTable\">"));
        assert!(xml.contains("<table:table-header-rows><table:table-row>"));
        assert!(xml.contains("text:style-name=\"Table_20_Heading\">Name"));
        assert!(xml.contains("text:style-name=\"MdgCellRight\">9"));
    }

    #[test]
    fn code_block_preserves_indentation() {
        let xml = render("```rust\nfn main() {\n    let x = 1;\n}\n```\n");
        assert!(xml.contains("<text:p text:style-name=\"Preformatted_20_Text\">fn main() {</text:p>"));
        assert!(xml.contains("<text:s text:c=\"4\"/>let x = 1;"));
    }

    #[test]
    fn blockquote_and_alert() {
        let xml = render("> [!NOTE]\n> Be careful.\n");
        assert!(xml.contains("<text:span text:style-name=\"Strong_20_Emphasis\">Note</text:span>"));
        assert!(xml.contains("<text:p text:style-name=\"Quotations\">Be careful.</text:p>"));
    }

    #[test]
    fn html_underline_round_trips() {
        let xml = render("A <u>careful</u> word.\n");
        assert!(xml.contains("<text:span text:style-name=\"Underline\">careful</text:span>"));
    }

    #[test]
    fn frontmatter_is_stripped_and_titles_extracted() {
        let (body, title) = strip_frontmatter("---\ntitle: My Doc\nother: 1\n---\n# Real\n");
        assert_eq!(body, "# Real\n");
        assert_eq!(title.as_deref(), Some("My Doc"));
        let xml = render("---\ntitle: My Doc\n---\n# Real\n");
        assert!(!xml.contains("title:"));
        assert!(xml.contains(">Real</text:h>"));
    }

    #[test]
    fn missing_image_keeps_alt_text() {
        let xml = render("![a diagram](nope/missing.png)\n");
        assert!(xml.contains("<text:span text:style-name=\"Emphasis\">[a diagram]</text:span>"));
    }

    #[test]
    fn embedded_image_is_packaged() {
        // 1x1 transparent PNG.
        let png = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let dir = unique_temp_dir("markdowngonzo-export-test").unwrap();
        let _cleanup = TempDir(dir.clone());
        fs::write(dir.join("pic.png"), png).unwrap();

        let events: Vec<Event> =
            Parser::new_ext("![shot](pic.png)\n", parser_options()).collect();
        let mut pictures = Vec::new();
        let footnotes = collect_footnotes(&events, Some(&dir), &mut pictures);
        let mut renderer = Renderer::new(Some(&dir), &footnotes);
        renderer.run(&events, &mut pictures);
        let xml = renderer.finish();

        assert!(xml.contains("<draw:image xlink:href=\"Pictures/image1.png\""));
        assert!(xml.contains("<svg:desc>shot</svg:desc>"));
        assert_eq!(pictures.len(), 1);
        assert_eq!(pictures[0].media_type, "image/png");
    }

    #[test]
    fn image_dimension_readers() {
        let png = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, b'I', b'H', b'D', b'R',
            0, 0, 0x01, 0x2C, 0, 0, 0, 0xC8, 8, 6, 0, 0, 0,
        ];
        assert_eq!(image_dimensions(&png), Some((300, 200)));
        let gif = *b"GIF89a\x20\x03\x58\x02\x00";
        assert_eq!(image_dimensions(&gif), Some((800, 600)));
    }

    #[test]
    fn zip_has_stored_mimetype_first() {
        let odt = markdown_to_odt("# Hi\n", None, "T").unwrap();
        assert_eq!(&odt[0..4], b"PK\x03\x04");
        // "mimetype" name then the literal mime bytes, uncompressed, right after
        // the first local header.
        let window = &odt[..80.min(odt.len())];
        let text = String::from_utf8_lossy(window);
        assert!(text.contains("mimetypeapplication/vnd.oasis.opendocument.text"));
        assert!(odt.windows(4).any(|w| w == b"PK\x01\x02"));
        assert!(odt.windows(4).any(|w| w == b"PK\x05\x06"));
    }

    /// Round-trips a representative document through the real ODF writer and
    /// LibreOffice. Ignored by default (needs LibreOffice); run with
    /// `cargo test -- --ignored libreoffice_accepts_generated_odt`.
    #[test]
    #[ignore]
    fn libreoffice_accepts_generated_odt() {
        let markdown = "---\ntitle: Fixture\n---\n\
            # MarkDownGonzo export\n\n\
            A paragraph with **bold**, *italic*, ~~strike~~, `code`, a \
            [link](https://example.com) and a footnote.[^1]\n\n\
            > [!NOTE]\n> Quoted text.\n\n\
            - one\n  - nested\n- [x] done\n\n\
            1. first\n2. second\n\n\
            | Name | Score |\n| :--- | ---: |\n| Gonzo | 9 |\n\n\
            ```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n\n\
            ---\n\n[^1]: The footnote body.\n";
        let (body, title) = strip_frontmatter(markdown);
        let odt = markdown_to_odt(body, None, title.as_deref().unwrap_or("Fixture")).unwrap();

        let dir = unique_temp_dir("markdowngonzo-odt-roundtrip").unwrap();
        let _cleanup = TempDir(dir.clone());
        let odt_path = dir.join("out.odt");
        fs::write(&odt_path, &odt).unwrap();

        let pdf_path = dir.join("out.pdf");
        convert_odt_to_pdf(&odt, &pdf_path).expect("LibreOffice conversion failed");
        let pdf = fs::read(&pdf_path).unwrap();
        assert!(pdf.starts_with(b"%PDF-"), "not a PDF");
        assert!(pdf.len() > 1000, "PDF suspiciously small: {} bytes", pdf.len());
        eprintln!("ok: {} byte odt -> {} byte pdf", odt.len(), pdf.len());
        if let Ok(out) = env::var("MDG_EXPORT_DUMP") {
            // Optional: keep the artifacts for manual inspection.
            let _ = fs::write(format!("{out}.odt"), &odt);
            let _ = fs::write(format!("{out}.pdf"), &pdf);
        }
    }

    #[test]
    fn footnotes_become_odf_notes() {
        let xml = render("Text with a note.[^a]\n\n[^a]: The note body.\n");
        assert!(xml.contains("<text:note text:id=\"ftn1\" text:note-class=\"footnote\">"));
        assert!(xml.contains("<text:note-citation>1</text:note-citation>"));
        assert!(xml.contains("The note body."));
        // The definition block itself is not rendered inline.
        assert!(!xml.contains("[^a]:"));
    }
}
