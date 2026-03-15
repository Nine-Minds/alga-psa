# Scratchpad — Invoice Designer Paper Presets and Margins

- Plan slug: `invoice-designer-paper-presets-and-margins`
- Created: `2026-03-14`

## What This Is

Working notes for adding named paper presets and configurable page margins to the invoice template designer while keeping designer, preview, and PDF output aligned.

## Decisions

- (2026-03-14) V1 scope is named paper presets only. No custom page dimensions.
- (2026-03-14) V1 margin scope is one uniform page margin value in millimeters. No per-side controls.
- (2026-03-14) Template-level print settings should be authoritative and persist in invoice template AST metadata.
- (2026-03-14) The plan must cover both current PDF generation services; changing only one path would preserve inconsistent output.
- (2026-03-14) This plan should introduce a shared PDF print-settings/options resolver rather than require full PDF service consolidation in the same change.
- (2026-03-14) Shared print-setting identifiers use Puppeteer-compatible preset names directly: `Letter`, `A4`, and `Legal`. This keeps AST metadata, UI labels, and PDF `format` values aligned without a second mapping layer.
- (2026-03-14) Default template print settings remain visually backward-compatible with the existing designer by using `Letter` plus the legacy `40px` page padding converted to `10.58mm`.
- (2026-03-14) Uniform page margins are clamped to a conservative `0-50mm` range in the shared utility and schema. This is permissive for normal print layouts while preventing obviously broken geometry.
- (2026-03-14) Shared AST-based print-settings resolution now lives in `packages/billing/src/lib/invoice-template-ast/printSettings.ts` so preview shells and both PDF services can infer the same paper preset/margin from explicit metadata or legacy width/height/padding.
- (2026-03-14) `PaperInvoice` should prefer full `templateAst` input over raw `printSettings` so legacy templates without explicit metadata still preview at the correct sheet size and printable inset.
- (2026-03-14) Server-side document PDFs keep their pre-existing `A4 + 10mm` defaults; only invoice-template PDF flows were switched to the shared invoice print-settings resolver in this plan.

## Discoveries / Constraints

- (2026-03-14) The design canvas is currently hard-coded to `816 x 1056` in `packages/billing/src/components/invoice-designer/constants/layout.ts`, which matches US Letter at `96dpi`.
- (2026-03-14) The hidden `page` node already carries what functions like a page margin via `layout.padding`, with a current default of `40px`.
- (2026-03-14) The preview shell is independently hard-coded in `packages/billing/src/components/billing-dashboard/PaperInvoice.module.css` with different dimensions/padding than the design canvas.
- (2026-03-14) There are two active invoice PDF generation implementations:
  - `packages/billing/src/services/pdfGenerationService.ts`
  - `server/src/services/pdf-generation.service.ts`
- (2026-03-14) The server-side PDF service hard-codes `A4` plus explicit `10mm` margins, while the package-level billing PDF service hard-codes `A4` without an explicit margin block.
- (2026-03-14) The current renderer/preview path already respects exported inline width/height/padding styles, so print settings can reuse existing AST/style plumbing instead of inventing a separate render pipeline.
- (2026-03-14) The AST already has template metadata, but schema/types only currently cover `templateName`, `description`, `locale`, and `currencyCode`.
- (2026-03-14) Review follow-up: invoice margins must be treated as part of the template HTML/CSS box model, not duplicated as extra Puppeteer print-area margins, otherwise PDF output shrinks relative to preview.
- (2026-03-14) Review follow-up: unmatched legacy page dimensions should round-trip without silently persisting fallback `Letter` print metadata on save.
- (2026-03-14) Review follow-up: the billing PDF path must resolve print options from the same canonical AST used to render invoice HTML, not from a potentially stale list payload.

## Completed Work

- (2026-03-14) Fixed invoice PDF parity so AST-backed invoice PDFs use zero Puppeteer margins and rely on template page padding for the printable inset, while generic document PDFs keep their existing default margin behavior.
- (2026-03-14) Hardened the billing PDF path to fetch canonical template AST when the list-selected template payload does not carry it, ensuring HTML rendering and PDF print options derive from the same template settings.
- (2026-03-14) Preserved unmatched legacy page dimensions during AST import/export instead of silently writing fallback `Letter` metadata for templates that do not map to a supported named preset.
- (2026-03-14) Fixed designer margin input behavior so blank drafts no longer commit `0mm`, and no-op print setting commits no longer create extra history entries.
- (2026-03-14) Adjusted invoice preview scaling to reserve space for the paper shell chrome so the selected sheet frame is not clipped in the preview panel.
- (2026-03-14) `exportWorkspace()` strips runtime `props.size`, so first-class print settings must update authored `style.width` / `style.height` and page `layout.padding` in addition to runtime `size` / `baseSize`.
- (2026-03-14) Workspace AST import/export is the key persistence seam for print settings: import can infer or honor explicit metadata, while export can always write canonical `metadata.printSettings` back to the AST.
- (2026-03-14) `packages/ui` `Input` does not forward the `id` prop directly to the underlying `<input>`, so component tests for the margin control should target the `spinbutton` role rather than `getElementById(...)`.
- (2026-03-14) Focused PDF service tests emit secret-file warnings in this worktree because `.env.localtest` falls back from `secrets/db_password_server` to env vars; the tests still pass and do not indicate a print-settings regression.

## Commands / Runbooks

- (2026-03-14) Inspect current designer canvas sizing:
  - `sed -n '1,80p' packages/billing/src/components/invoice-designer/constants/layout.ts`
  - `sed -n '1360,1465p' packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx`
- (2026-03-14) Inspect current page/document defaults:
  - `sed -n '621,687p' packages/billing/src/components/invoice-designer/state/designerStore.ts`
  - `sed -n '561,607p' packages/billing/src/components/invoice-designer/schema/componentSchema.ts`
- (2026-03-14) Inspect current preview paper shell:
  - `sed -n '1,120p' packages/billing/src/components/billing-dashboard/PaperInvoice.tsx`
  - `sed -n '1,120p' packages/billing/src/components/billing-dashboard/PaperInvoice.module.css`
- (2026-03-14) Inspect current AST metadata/schema:
  - `sed -n '1,80p' packages/types/src/lib/invoice-template-ast.ts`
  - `sed -n '422,448p' packages/billing/src/lib/invoice-template-ast/schema.ts`
- (2026-03-14) Inspect current PDF generation paths:
  - `sed -n '1,220p' packages/billing/src/services/pdfGenerationService.ts`
  - `sed -n '240,390p' server/src/services/pdf-generation.service.ts`
- (2026-03-14) Validate the plan folder after edits:
  - `python3 scripts/validate_plan.py ee/docs/plans/2026-03-14-invoice-designer-paper-presets-and-margins`
- (2026-03-14) Focused validation for the shared print-settings/model slice:
  - `cd server && npx vitest run --config vitest.config.ts ../packages/billing/src/lib/invoice-template-ast/printSettings.test.ts ../packages/billing/src/lib/invoice-template-ast/schema.test.ts ../packages/billing/src/components/invoice-designer/ast/workspaceAst.printSettings.test.ts ../packages/billing/src/components/invoice-designer/state/designerStore.printSettings.test.ts`
  - `cd server && npx vitest run --config vitest.config.ts ../packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts ../packages/billing/src/components/invoice-designer/state/designerStore.exportWorkspace.test.ts ../packages/billing/src/components/invoice-designer/state/designerStore.exportWorkspace.canonical.test.ts ../packages/billing/src/components/invoice-designer/state/designerStore.loadWorkspace.legacy.test.ts`
- (2026-03-14) Focused validation for designer UI, preview shell, and PDF resolver wiring:
  - `cd server && npx vitest run --config vitest.config.ts ../packages/billing/src/lib/invoice-template-ast/printSettings.test.ts ../packages/billing/src/components/invoice-designer/state/designerStore.printSettings.test.ts ../packages/billing/src/components/invoice-designer/DesignerShell.printSettings.integration.test.tsx ../packages/billing/src/components/invoice-designer/canvas/DesignCanvas.printSettings.integration.test.tsx ../packages/billing/src/components/billing-dashboard/PaperInvoice.printSettings.test.tsx ../packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx ../packages/billing/src/services/pdfGenerationService.printSettings.test.ts ../server/src/services/pdf-generation.service.printSettings.test.ts`

## Links / References

- Related prior plans:
  - `ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace/`
  - `ee/docs/plans/2026-02-12-invoice-template-json-ast-renderer-cutover/`
  - `ee/docs/plans/2026-02-13-invoice-designer-native-css-layout-engine/`
  - `ee/docs/plans/2026-03-08-invoice-template-transforms-designer/`
- Key implementation files:
  - `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
  - `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx`
  - `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx`
  - `packages/billing/src/components/invoice-designer/state/designerStore.ts`
  - `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`
  - `packages/billing/src/components/billing-dashboard/PaperInvoice.tsx`
  - `packages/billing/src/components/billing-dashboard/PaperInvoice.module.css`
  - `packages/billing/src/services/pdfGenerationService.ts`
  - `server/src/services/pdf-generation.service.ts`

## Open Questions

- If a legacy template’s dimensions do not match any supported preset cleanly, should the editor display a fallback preset silently or surface a “legacy unresolved” state? Current plan assumes fallback behavior can stay silent if rendering remains stable.

## Progress Log

- (2026-03-14) Completed `F001` by adding shared invoice print preset utilities in `packages/types/src/lib/invoice-print-settings.ts`, including mm dimensions, px dimensions at `96dpi`, preset lookup, margin clamping, legacy inference, and shared PDF option resolution primitives.
- (2026-03-14) Completed `F002` by extending `InvoiceTemplateAstMetadata` and the billing AST schema with additive `metadata.printSettings.paperPreset` and `metadata.printSettings.marginMm`.
- (2026-03-14) Completed `F003` by teaching workspace AST import/export to resolve print settings from legacy document/page width, height, and page padding when explicit metadata is absent.
- (2026-03-14) Completed `F004` by round-tripping explicit print settings through workspace AST import/export so reopened designer workspaces keep canonical template-level print metadata.
- (2026-03-14) Completed `F005` by adding `applyPrintSettings` in `designerStore.ts` to update document/page runtime size, baseSize, authored width/height, page padding, and document metadata together.
- (2026-03-14) Completed `F006` by bootstrapping new designer workspaces and component schema defaults from the shared default print settings instead of fixed hard-coded geometry.
- (2026-03-14) Completed `F007` / `F008` / `F009` by wiring a no-selection page-setup inspector in `packages/billing/src/components/invoice-designer/DesignerShell.tsx` and driving live paper-preset / margin updates into `DesignCanvas` geometry and ruler extents via `applyPrintSettings`.
- (2026-03-14) Completed `F010` / `F011` by teaching `PaperInvoice` and preview consumers (`DesignerVisualWorkspace.tsx`, `InvoicePreviewPanel.tsx`, `InvoiceTemplateManager.tsx`) to resolve sheet size and printable inset from the template AST, including legacy inference.
- (2026-03-14) Completed `F012` by adding shared AST-based print-resolution / PDF-options helpers in `packages/billing/src/lib/invoice-template-ast/printSettings.ts`.
- (2026-03-14) Completed `F013` / `F014` / `F015` by switching both invoice PDF services to shared AST-derived PDF print options and verifying the two services pass identical `page.pdf(...)` options for the same template settings.
- (2026-03-14) Completed `F016` by covering legacy no-metadata fallback through existing load/save tests plus new preview-shell and billing PDF-service fallback coverage.
- (2026-03-14) Completed `F017` by adding focused regression coverage for designer page-setup controls, canvas reshaping, preview shell sizing, authoritative preview export, shared PDF option resolution, both PDF services, and legacy fallback behavior.
- (2026-03-14) Completed `T001` / `T002` with shared preset registry coverage in `packages/billing/src/lib/invoice-template-ast/printSettings.test.ts`.
- (2026-03-14) Completed `T003` / `T004` / `T005` with AST schema validation coverage for valid print metadata, unknown presets, and out-of-range margins in `packages/billing/src/lib/invoice-template-ast/schema.test.ts`.
- (2026-03-14) Completed `T006` / `T007` / `T008` / `T009` / `T010` with workspace AST print-settings inference and round-trip coverage in `packages/billing/src/components/invoice-designer/ast/workspaceAst.printSettings.test.ts`.
- (2026-03-14) Completed `T012` / `T013` / `T014` / `T015` with designer-store print-settings coverage in `packages/billing/src/components/invoice-designer/state/designerStore.printSettings.test.ts`.
- (2026-03-14) Completed `T016` / `T017` / `T018` / `T019` / `T020` in `packages/billing/src/components/invoice-designer/DesignerShell.printSettings.integration.test.tsx`.
- (2026-03-14) Completed `T021` in `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.printSettings.integration.test.tsx`.
- (2026-03-14) Completed `T022` / `T023` / `T024` with explicit and legacy preview-shell coverage in `packages/billing/src/components/billing-dashboard/PaperInvoice.printSettings.test.tsx`.
- (2026-03-14) Completed `T025` in `packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx`.
- (2026-03-14) Completed `T026` / `T027` in `packages/billing/src/lib/invoice-template-ast/printSettings.test.ts`.
- (2026-03-14) Completed `T028` / `T030` / `T031` in `server/src/services/pdf-generation.service.printSettings.test.ts`.
- (2026-03-14) Completed `T029` / `T032` / `T033` in `packages/billing/src/services/pdfGenerationService.printSettings.test.ts`.
- (2026-03-14) Completed `T034` by running the focused regression suite spanning schema, workspace/store, designer shell, design canvas, preview shell, preview workspace, and both PDF services.
