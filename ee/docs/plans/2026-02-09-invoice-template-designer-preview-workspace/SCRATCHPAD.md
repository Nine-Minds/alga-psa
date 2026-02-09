# Scratchpad — Invoice Template Designer Preview Workspace

- Plan slug: `invoice-template-designer-preview-workspace`
- Created: `2026-02-09`

## What This Is

Working notes for adding a preview workspace to the invoice template designer so users can iterate on design with sample and real invoice data without leaving the editor.

## Decisions

- (2026-02-09) Place Preview as a secondary tab inside `Visual` mode (`Design` / `Preview`) instead of adding a separate page route, so context switching stays immediate.
- (2026-02-09) Support two preview data sources in MVP: curated sample fixtures + existing tenant invoices.
- (2026-02-09) Keep preview read-only and side-effect free; no invoice/template writes triggered by preview interactions.
- (2026-02-09) Reuse existing invoice fetch/mapping actions where possible rather than introducing new invoice-specific backend models.

## Discoveries / Constraints

- (2026-02-09) `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx` currently has top-level `Visual`/`Code` tabs and hydrates designer workspace from source-embedded metadata or localStorage.
- (2026-02-09) `packages/billing/src/components/invoice-designer/DesignerShell.tsx` currently drives design interactions; it does not currently expose a dedicated preview tab.
- (2026-02-09) `packages/billing/src/components/invoice-designer/canvas/previewScaffolds.ts` already provides placeholder/fallback semantics for field and label bindings.
- (2026-02-09) Existing invoice preview infrastructure already exists outside designer in `packages/billing/src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx` and `packages/billing/src/components/billing-dashboard/TemplateRenderer.tsx`.
- (2026-02-09) Invoice list/detail actions exist and are tenant-aware: `fetchInvoicesPaginated` and `getInvoiceForRendering` in `packages/billing/src/actions/invoiceQueries.ts`.
- (2026-02-09) Sample invoice fixture data exists in `packages/billing/src/utils/sampleInvoiceData.ts` but may need designer-specific fixture shaping and scenario curation.

## Commands / Runbooks

- (2026-02-09) Scaffold plan: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Invoice Template Designer Preview Workspace" --slug invoice-template-designer-preview-workspace --plans-root ee/docs/plans --date-prefix`
- (2026-02-09) Find invoice-designer integration points: `rg -n "DesignerShell|invoice-designer|InvoiceTemplateEditor" packages/billing/src`
- (2026-02-09) Validate existing preview infrastructure: `rg -n "TemplateRenderer|InvoicePreviewPanel|renderTemplateOnServer" packages/billing/src`

## Links / References

- `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`
- `packages/billing/src/components/invoice-designer/DesignerShell.tsx`
- `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx`
- `packages/billing/src/components/invoice-designer/canvas/previewScaffolds.ts`
- `packages/billing/src/actions/invoiceQueries.ts`
- `packages/billing/src/lib/adapters/invoiceAdapters.ts`
- `packages/billing/src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx`
- `packages/billing/src/components/billing-dashboard/TemplateRenderer.tsx`
- `docs/billing/invoice_templates.md`

## Open Questions

- Should preview fidelity in this phase be based only on designer bindings, or must it also match current AssemblyScript/Wasm output exactly?
- Should existing-invoice lookup default to all statuses, drafts only, or finalized only?
- Should preview remember selected sample/invoice across browser sessions or only during the current edit session?
- Which sample scenarios are mandatory for MVP beyond a basic/default invoice?
- (2026-02-09) Completed `F001`: Added `Design`/`Preview` secondary tabs under Visual by introducing `DesignerVisualWorkspace` and wiring it inside `InvoiceTemplateEditor`, so users can switch design vs preview without leaving the editor shell.
- (2026-02-09) Completed `F002`: Defaulted the nested visual workspace state to Design while preserving top-level Visual/Code tabs.
