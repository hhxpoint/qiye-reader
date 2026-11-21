# Changelog

All notable changes to 栖页 are documented here. The project follows a simple
versioning scheme; the current public preview is `0.1.0`.

## 0.1.0 - 2026-11-21

Initial public source release.

### Reading workspace

- React 19 and TypeScript reading desk with a warm paper visual system.
- PDF import with local rendering, text-block extraction, source page numbers
  and layout warnings.
- Original teaching examples that contain no prewritten translations.
- Responsive reader and focus mode, with reduced-motion support.

### Translation

- Browser Worker using OPUS-MT `onnx-community/opus-mt-en-zh` at a fixed revision.
- q8 ONNX weights with ONNX Runtime Web and a same-origin tokenizer.
- Paragraph-level progress, cancellation, immediate saving and a retryable
  worker lifecycle.
- Human-edited translations are marked and protected from automatic overwrite.
- Numeric, negation, modality and glossary checks after translation.

### Evidence, notes and data

- Source-grounded evidence extraction with page and paragraph links.
- Note drafts in sessionStorage and saved notes linked to source blocks.
- IndexedDB storage for papers, PDF files and settings.
- Strict backup validation, atomic restore and full-library JSON export.

### Export

- PDF export with a full embedded Chinese font, source page numbers and an
  optional source-page appendix.
- Word export with editable text and 1800 px full-page source images in
  portrait or landscape sections.
- Markdown export for lightweight text workflows.
- Source-page copying deduplicates shared images and fonts.
- Export cancellation, size limits and missing-image detection.

### Quality and delivery

- 54 regression checks covering storage, text handling, worker messaging,
  export models, page ranges and image failure handling.
- Production build, TypeScript check and dependency audit completed before the
  public release.
- Qoder Sites deployment with a public, static build.
