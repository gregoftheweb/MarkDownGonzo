# MarkDownGonzo Implementation Plan

## Current status

- Phase 0 completed on 2026-08-29.
- Phase 1 completed on 2026-08-29.
- Phase 2 completed on 2026-08-29.
- Phase 3 is partially complete: the main formatting toolbar actions, keyboard commands, links, basic table insertion, and word count are implemented. Active formatting states, the text-style selector, code-language highlighting, table manipulation, find/replace, and spellcheck settings remain.
- Phase 4 core implementation is complete: relative and remote image rendering, picker/paste/drop imports, asset-directory selection, safe filenames and collisions, missing-image presentation, reference removal, and recoverable file deletion are implemented.
- Phase 4 still needs an interactive desktop smoke test covering picker, paste, drag/drop, unnamed-document saving, multiple-image import, and reuse of existing asset directories.
- Phase 5 is partially complete: configuration loading, fonts, themes, accents, focus mode, application branding, and packaging metadata are present. Settings persistence/UI, configuration reload, responsive toolbar overflow, accessibility review, release validation, and performance measurements remain.
- Automated validation on 2026-08-29 passes: 10 frontend tests, 4 Rust tests, TypeScript compilation, and the Vite production build.

## Immediate validation order

1. Run the image workflow smoke test in a debug Tauri build so WebView and backend failures retain useful diagnostics.
2. After the debug workflow passes, repeat the critical open/edit/save and image picker/paste/drop paths once in a packaged release build.
3. Confirm the generated Markdown and relative assets render correctly outside MarkDownGonzo, including in a representative repository README.
4. Complete the remaining Phase 3 and Phase 5 editor polish, then perform the full MVP acceptance pass.

## Technical direction

- Tauri 2 provides the Linux desktop shell, native dialogs, launch arguments, and single-instance behavior.
- React and TypeScript provide the UI.
- TipTap/ProseMirror provides the WYSIWYG editing model.
- CodeMirror 6 provides raw Markdown editing.
- A GFM parser/serializer boundary owns conversion between file text and the visual document.
- Rust commands own unrestricted user-selected file I/O, atomic writes, filesystem watching, configuration, and asset copying. The frontend receives a deliberately narrow command API.
- TOML stores editable preferences; JSON stores session state.

Dependency versions are locked through `package-lock.json` and `Cargo.lock`. The scaffold starts with a functional UI shell and adds editing/file capabilities in vertical slices.

## Phase 0: scaffold and design shell

- Establish Vite, React, TypeScript, ESLint, and Tauri 2.
- Establish product tokens and all eight light/dark accent combinations.
- Build the window composition: sidebar, tabs, toolbar, editor canvas, and status bar.
- Implement local UI interactions for collapsing chrome, switching themes, selecting the system fonts, and changing zoom.
- Add unit-test plumbing and basic accessibility checks.

Exit condition: web checks pass, Rust compiles, and the desktop shell opens with the responsive MarkDownGonzo layout.

## Phase 1: document and filesystem core

- Define typed document, tab, recent-file, settings, and session models.
- Implement native Open/Save dialogs and narrow Rust filesystem commands.
- Implement atomic save, debounced autosave, Save As, unnamed draft recovery, and external-change detection.
- Implement session restore and recent-file cleanup/sorting.
- Add command-line file opening and single-instance forwarding.

Exit condition: plain Markdown files can be safely opened, edited as text, autosaved, restored, and externally modified without data loss.

## Phase 2: editing engines and round-trip safety

- Integrate CodeMirror 6 for raw mode.
- Integrate TipTap with the GFM-compatible extension set.
- Build the Markdown parser/serializer boundary, including YAML frontmatter preservation.
- Add fixture-based round-trip tests for every supported construct and representative GitHub README files.
- Preserve unsupported syntax as protected content rather than dropping it.

Exit condition: switching modes preserves supported GFM and does not silently destroy unknown content.

## Phase 3: formatting workflow

- Connect toolbar actions and keyboard shortcuts to the editor.
- Implement headings, emphasis, underline HTML, links, lists, blockquotes, inline code, and code blocks.
- Implement code language selection and syntax highlighting.
- Implement visual GFM table manipulation.
- Add find/replace, word counts, and system spellcheck controls.

Exit condition: the approved toolbar features are keyboard accessible and serialize into clean GFM.

## Phase 4: image workflow

- Render existing relative and HTTPS images.
- Implement file-picker, drag/drop, and clipboard imports.
- Detect/suggest asset directories, clean names, resolve collisions, copy safely, and insert relative links.
- Handle unnamed documents by deferring asset placement until the document has a location.
- Add missing-image presentation and explicit image-file deletion.

Exit condition: a README and its imported images can be committed normally and render on GitHub.

## Phase 5: configuration and polish

- Parse, validate, generate, and reload `config.toml`.
- Resolve generic system fonts and expose the curated body-font list.
- Complete themes, focus mode, responsive toolbar overflow, and accessibility review.
- Add packaging metadata, desktop entry, icons, MIME associations, and release builds.
- Measure cold start, editor latency, idle memory, and package size.

Exit condition: the MVP acceptance criteria in the product specification pass on the target Linux environment.

## Quality strategy

- Unit tests cover models, path handling, configuration validation, and Markdown conversions.
- Golden fixtures cover GFM round trips and preservation of frontmatter/unsupported syntax.
- Integration tests cover file saving, external changes, session recovery, recent-note cleanup, and asset collisions.
- End-to-end smoke tests cover launch, open, edit, save, mode switch, restart, and restore.
- Manual GitHub rendering fixtures validate output without introducing Git integration into the app.

## Early risk register

| Risk | Response |
| --- | --- |
| Markdown round trips rewrite or lose syntax | Put conversion behind one tested boundary; preserve unsupported nodes verbatim. |
| Browser editing edge cases | Use ProseMirror rather than contenteditable directly; test selection, clipboard, undo, and IME behavior. |
| Tauri filesystem permissions block arbitrary selected files | Keep path authority in narrowly scoped Rust commands and validate every operation. |
| Autosave overwrites external changes | Track file identity/mtime and require resolution before saving. |
| Local images break after moving documents | Use document-relative paths, show missing assets, and never rewrite existing paths implicitly. |
| Font availability differs by machine | Use fontconfig generic defaults and safe fallbacks; keep the curated list configurable. |
