# Invoice Label Styles

## Problem
Users need invoice labels such as “Invoice #”, “Issue Date”, “Due Date”, and totals-row labels to be stylable independently from their values. Today the invoice designer has limited preview-only label weight behavior, while production PDF rendering outputs field labels as plain spans.

## Goals
- Let users style field labels independently from field values and containers.
- Support common typography controls: font weight, size, color, family, line height, italic/style, and text alignment where applicable.
- Keep designer preview, saved template AST, imported templates, and production PDF rendering consistent.
- Apply the same label-style data model to standalone totals rows and AST totals rows for consistency.

## Non-goals
- Rich text editing inside labels.
- Per-character styling.
- Changing invoice value styling in this work.

## UX Notes
- Add a Label Style panel to Data Field and Totals Row inspectors.
- Controls write to a label-specific style object, not the container style.
- Existing templates render unchanged unless label styles are explicitly set.

## Data Model / Rendering
- Add `labelStyle?: TemplateNodeStyleRef` to `TemplateFieldNode`.
- Add `labelStyle?: TemplateNodeStyleRef` to `TemplateTotalsRow`.
- Render field label spans and totals label spans with the resolved label style.
- Import/export label styles via designer metadata at `metadata.labelStyle`.

## Acceptance Criteria
- A user can set field label style in the designer and see it in preview.
- Exported AST includes `labelStyle` for styled labels.
- Imported AST label styles round-trip without loss.
- Production HTML/PDF renderer applies `labelStyle` to labels only.
- Totals row labels support the same style object.
