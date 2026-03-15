# PRD — Invoice Designer Paper Presets and Margins

- Slug: `invoice-designer-paper-presets-and-margins`
- Date: `2026-03-14`
- Status: Draft

## Summary

Add first-class print settings to the invoice template designer so template authors can choose a named paper preset and a configurable uniform page margin, and have the designer canvas, preview surface, and generated PDFs all honor the same settings.

V1 scope is intentionally constrained:

- named paper presets only
- one uniform page margin value in millimeters
- no custom paper sizes
- no per-side margin controls

The implementation should introduce a shared print-settings model and a shared PDF print-options resolver so both current PDF generation paths behave consistently without requiring a full service consolidation in the same change.

## Problem

The invoice template designer currently has no intentional page-setup model.

Instead, page size and printable area are split across unrelated hard-coded implementations:

- the design canvas uses a fixed `816 x 1056` surface, which is US Letter at `96dpi`
- the page node defaults include `40px` padding that acts like a content margin
- the preview shell uses a separate fixed “paper” chrome with different dimensions and padding
- one PDF generation path hard-codes `A4` with explicit `10mm` margins
- another PDF generation path hard-codes `A4` with no explicit margin block

This creates three user-facing failures:

1. template authors cannot intentionally choose a target sheet size
2. PDF output margin behavior is inconsistent and not user-configurable
3. designer, preview, and exported PDF can disagree about what the page actually is

## Goals

- Let template authors choose a named paper preset from the designer UI.
- Let template authors set a uniform page margin value for the template.
- Make the designer artboard reshape immediately when the selected paper preset changes.
- Make the preview shell reflect the same page dimensions and printable inset as the selected settings.
- Make both current PDF generation paths honor the same resolved paper preset and margin settings.
- Preserve compatibility for existing templates without requiring a database migration.
- Keep one authoritative template-level source of truth for print settings.

## Non-goals

- Custom paper sizes in v1.
- Separate top/right/bottom/left margin controls in v1.
- Full multi-page pagination or page-break authoring improvements.
- Full consolidation of the package-level and server-level PDF services in this plan.
- New observability, metrics, rollout flags, or operational tooling beyond normal validation and regression coverage.

## Users and Primary Flows

### Primary users

- Billing admins authoring invoice templates.
- Implementers validating that visual designer output matches exported PDFs.

### Primary flows

1. **Choose a paper preset**
   - User opens the invoice template designer.
   - User selects `Letter`, `A4`, or `Legal`.
   - The artboard, rulers, and visible page chrome reshape immediately.

2. **Adjust page margin**
   - User edits the page margin in millimeters.
   - The printable area inset updates in the designer and preview.
   - Saving the template persists the setting.

3. **Preview with production parity**
   - User opens preview for a sample or existing invoice.
   - Preview reflects the same sheet size and margin as the design surface.

4. **Generate a PDF**
   - User generates or downloads a PDF through any existing invoice PDF flow.
   - The generated PDF uses the selected paper preset and margin instead of hard-coded defaults.

5. **Open an older template**
   - User opens an existing template that predates explicit print settings.
   - The system infers or falls back to sensible resolved settings without breaking load, preview, save, or PDF generation.

## UX / UI Notes

- Print settings must be reachable even though the `page` node is not normally selectable on the canvas.
- V1 should expose page setup in a dedicated, obvious control surface in the designer, such as:
  - a document/page settings section in the inspector when no specific child node is selected, or
  - a page setup control area in the designer shell/toolbar
- Paper preset control:
  - dropdown/select with named presets
  - initial preset list for v1: `Letter`, `A4`, `Legal`
- Margin control:
  - numeric input in millimeters
  - one value applied uniformly to all sides
  - live updates while editing, with validation/clamping for obviously invalid values
- The preview paper shell should stop using independent fixed dimensions and instead derive its chrome from resolved print settings.
- The code tab remains generated/read-only; no raw print-settings JSON editor is needed in v1.

## Requirements

### Functional Requirements

- `FR-001` Add a shared invoice print preset registry for at least `Letter`, `A4`, and `Legal`.
- `FR-002` Represent template print settings as first-class invoice template AST metadata, including paper preset identity and uniform margin.
- `FR-003` Keep print settings additive and backward-compatible so templates without explicit print metadata still load and render.
- `FR-004` Infer legacy/resolved print settings from existing page/document width, height, and padding when explicit metadata is absent and known preset dimensions are detected.
- `FR-005` Preserve print settings through designer workspace import/export, save, reopen, and preview flows.
- `FR-006` Add a designer store action that applies print settings by synchronizing runtime geometry and authored style/layout state for the hidden document/page nodes.
- `FR-007` Initialize new designer workspaces with default print settings and matching document/page geometry.
- `FR-008` Add reachable UI controls for selecting a named paper preset in the visual designer.
- `FR-009` Add reachable UI controls for editing a uniform margin value in millimeters.
- `FR-010` Validate paper preset and margin input so invalid settings are rejected or corrected before they produce broken layout/PDF output.
- `FR-011` Update the design canvas, artboard bounds, and rulers to derive dimensions from resolved print settings instead of fixed constants alone.
- `FR-012` Update the preview paper shell to derive visible sheet dimensions and printable inset from resolved print settings instead of hard-coded CSS dimensions and padding.
- `FR-013` Ensure authoritative preview export/render uses the resolved page size and margin so preview content matches the configured print settings.
- `FR-014` Introduce a shared resolver that converts template print settings into Puppeteer PDF options.
- `FR-015` Wire the server-side invoice PDF generation service to the shared print-settings resolver instead of hard-coded `A4`/margin defaults.
- `FR-016` Wire the package-level billing PDF generation service to the same shared print-settings resolver instead of hard-coded `A4` defaults.
- `FR-017` Ensure both current PDF generation paths produce the same paper preset and margin behavior for the same template settings.
- `FR-018` Preserve older templates with no explicit print metadata through preview and PDF generation without schema migration or manual repair.

### Non-functional Requirements

- `NFR-001` Mapping from named paper preset -> designer size -> preview shell -> Puppeteer options must be deterministic and centralized.
- `NFR-002` Existing invoice templates must remain loadable and editable without a breaking schema migration.
- `NFR-003` The designer should reshape quickly enough that switching paper presets feels immediate in normal editing flows.
- `NFR-004` Print setting changes must not create parity drift between preview and generated PDFs.
- `NFR-005` V1 should minimize scope by reusing the existing template AST, workspace import/export, preview pipeline, and PDF generation entry points.

## Data / API / Integrations

- Extend invoice template AST metadata to include a print-settings shape, for example:
  - `paperPreset`
  - `marginMm`
- Keep template-level metadata as the semantic source of truth.
- Continue exporting resolved width/height/padding into the AST layout/styles needed by the current renderer paths so existing HTML/CSS rendering behavior stays compatible.
- Add a shared preset/dimension utility that can:
  - map preset -> physical size in mm
  - map preset -> editor size in px at `96dpi`
  - convert uniform margin mm -> preview/canvas padding representation
  - convert resolved settings -> Puppeteer `format` and `margin`
- Update the workspace import/export layer so explicit metadata wins, while legacy width/height/padding can still be interpreted when metadata is absent.
- No new external API endpoints are required for v1.

## Security / Permissions

- No new permission model is introduced.
- Existing invoice template edit permissions continue to govern who can change print settings.
- Existing invoice/PDF read or generate permissions continue to govern who can preview or export invoices.

## Observability

- No new observability scope is included in v1 beyond normal editor validation states and existing error surfacing.

## Rollout / Migration

- No database migration is required.
- Existing templates without explicit print metadata should load through inference or fallback behavior.
- New templates should initialize with explicit print settings so they no longer depend on legacy hard-coded geometry alone.
- This plan does not require immediate consolidation of the two PDF services, but it does require both services to share one print-settings resolution path.

## Open Questions

- None blocking for the v1 plan. The selected scope is:
  - named presets only
  - uniform margin only
  - no custom sizes

## Acceptance Criteria (Definition of Done)

- A template author can choose a named paper preset in the invoice designer.
- A template author can set a uniform page margin in millimeters.
- Changing the selected preset reshapes the designer canvas to the matching page size.
- Preview reflects the same page size and printable inset as the selected settings.
- Both current PDF generation paths honor the same selected preset and margin instead of hard-coded defaults.
- Existing templates without explicit print settings still load, preview, save, and export successfully.
- Saving and reopening a template preserves the configured paper preset and margin.
- Automated coverage exists for schema/import-export behavior, canvas reshape behavior, preview shell behavior, and both PDF paths.
