# PRD — Invoice Template Designer Preview Workspace

- Slug: `invoice-template-designer-preview-workspace`
- Date: `2026-02-09`
- Status: Draft

## Summary

Add a first-class preview workspace to the Invoice Template Designer so users can quickly toggle between editing and rendered preview while iterating on layout. The preview must support:

- curated sample invoices (for teams with no invoice history yet), and
- existing tenant invoices (to validate real-world output against current data).

The workflow should live directly inside the invoice template editor so users can switch between Design and Preview without leaving context.

## Problem

The current visual designer only shows scaffolded placeholder values on the canvas. That makes it hard to:

- evaluate whether a template actually reads well with realistic invoice data,
- design templates before any real invoices have been generated, and
- compare a design against existing customer invoices before saving.

Without a fast toggle loop, users have to save and navigate to other parts of billing to validate output, which slows iteration and increases template defects.

## Goals

- Provide a dedicated preview view inside the Invoice Template Designer with a one-click toggle from the editing canvas.
- Allow previewing against both sample invoices and existing tenant invoices.
- Reflect unsaved designer changes in preview so users can iterate without saving/reloading.
- Keep the preview read-only and safe (no invoice/template persistence side effects).
- Maintain current template save semantics and existing Visual/Code editor behavior.

## Non-goals

- Re-architecting the AssemblyScript/Wasm rendering pipeline.
- Editing invoice business data (line items, tax, client data) from the preview surface.
- Introducing print/PDF-specific tuning controls in this phase.
- Changing template assignment rules or invoice generation/finalization workflows.
- Adding metrics/telemetry rollouts beyond existing logging and UI error handling.

## Users and Primary Flows

Primary personas:

- Billing admins designing invoice templates.
- Implementers validating GUI template behavior before enabling for broader tenant use.

Primary flows:

1. **Design with no real invoices**
   - User opens template editor and enters Visual mode.
   - User switches to Preview.
   - User selects a sample invoice scenario (for example: simple services, discounted invoice, high line-count invoice).
   - User toggles back to Design, adjusts blocks, and returns to Preview repeatedly.

2. **Validate against existing invoice**
   - User switches data source to Existing invoices.
   - User searches/selects a real invoice from tenant data.
   - User confirms layout/spacing/labels and totals using the selected invoice.

3. **Save after previewing**
   - User returns to Design (or Code), makes final adjustments, and saves template.
   - Save behavior remains unchanged from current editor flow.

## UX / UI Notes

- Keep current top-level editor tabs:
  - `Visual`
  - `Code`
- Within `Visual`, add a secondary tab group:
  - `Design` (current designer shell)
  - `Preview` (new read-only rendering surface)
- Preview controls should include:
  - Data source toggle: `Sample` / `Existing`
  - Sample selector (when `Sample`)
  - Invoice search/select control (when `Existing`)
  - Clear loading/error/empty states
- Switching Design <-> Preview should preserve current unsaved workspace and avoid re-initializing designer state.
- Preview should visually match the design canvas scale conventions, but interactivity remains disabled in preview mode.

## Requirements

### Functional Requirements

- Add an in-editor Preview tab inside the Visual editor experience.
- Allow users to choose between sample invoices and existing invoices as preview data sources.
- Provide a curated sample invoice set for immediate use in tenants with no invoice history.
- Allow searching/selecting an existing invoice from the tenant.
- Load invoice detail payload for selected existing invoice and map it into preview model shape.
- Render bound designer fields using selected preview data; fall back to placeholder scaffolds when data is missing.
- Render line item/totals-related sections from selected invoice amounts and items.
- Recompute preview when the designer workspace changes, without requiring save.
- Keep preview read-only (no drag, drop, resize, or selection mutation).
- Preserve existing Save/Cancel behavior in `InvoiceTemplateEditor`.
- Keep existing feature-flag behavior (`invoice-template-gui-designer`) intact.
- Add stable automation IDs for preview controls and key states.

### Non-functional Requirements

- Preview should switch between Design and Preview with low latency in normal dev/prod conditions.
- Sample preview should render without any server round-trip beyond initial page/app load.
- Existing-invoice preview loading should provide explicit loading and error feedback.
- Preview data fetch and rendering must not write to invoice or template tables.

## Data / API / Integrations

- Reuse existing billing actions where possible:
  - `fetchInvoicesPaginated` for searchable invoice listing.
  - `getInvoiceForRendering` for selected invoice detail.
  - `mapDbInvoiceToWasmViewModel` (or equivalent mapping utility) for normalized preview data shape.
- Introduce a dedicated preview data helper/module for sample invoice scenarios (designer-focused fixtures).
- Keep `InvoiceTemplateEditor` as integration point for tab state and data source selection.

## Security / Permissions

- Existing invoice preview must remain tenant-scoped through existing authenticated server actions.
- No cross-tenant data exposure through invoice search/select.
- Preview endpoints/actions must not bypass existing billing permission checks already required to access invoice templates.

## Observability

- No new telemetry/monitoring scope in this phase.
- Ensure failures surface clear user-facing error messages and retain existing console/server logging patterns for debugging.

## Rollout / Migration

- Ship under existing GUI designer feature flag path; no schema migration required.
- No backfill needed.
- Existing templates without designer metadata should still load with current reset/default workspace behavior and be previewable via sample data.

## Open Questions

1. Should preview fidelity target the GUI designer model only, or should it also execute current AssemblyScript output for strict parity in this phase?
2. For existing invoice selection, should the default filter include both `draft` and `finalized` invoices, or prioritize one status by default?
3. Should preview remember last selected sample/invoice per template across browser sessions, or only per in-memory editor session?
4. What is the minimum required sample fixture set (for example: simple, discount-heavy, high-line-count, credit-applied)?
5. Do we need a side-by-side mode (`Design` + `Preview`) in MVP, or is tab toggle sufficient?

## Acceptance Criteria (Definition of Done)

- [ ] In Visual mode, users can switch between `Design` and `Preview` without leaving the template editor.
- [ ] Preview supports `Sample` and `Existing` data sources.
- [ ] At least three curated sample invoice scenarios are available and selectable.
- [ ] Users can search/select an existing tenant invoice and view it in Preview.
- [ ] Unsaved designer workspace changes are reflected in Preview when toggling/re-rendering.
- [ ] Preview remains read-only and does not mutate template or invoice data.
- [ ] Save/Cancel flows continue to behave as before.
- [ ] Automated tests cover tab behavior, data-source switching, data mapping fallbacks, and read-only guarantees.
