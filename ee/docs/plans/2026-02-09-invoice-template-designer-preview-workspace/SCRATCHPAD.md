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
- (2026-02-09) Completed `F003`: Design/Preview toggling now keeps workspace data in the shared designer store so unsaved node edits persist.
- (2026-02-09) Completed `F004`: Lifted nested visual tab state into InvoiceTemplateEditor so Visual->Code->Visual returns to the prior nested tab.
- (2026-02-09) Completed `F005`: Added reducer-driven preview session state for source kind, sample/invoice selection, and async loading/error state.
- (2026-02-09) Completed `F006`: Created three curated sample preview scenarios with realistic headers, totals, and line-item data.
- (2026-02-09) Completed `F007`: Added sample scenario selector UI that is conditionally shown for the Sample source.
- (2026-02-09) Completed `F008`: Added existing-invoice selector/search controls that are conditionally shown for the Existing source.
- (2026-02-09) Completed `F009`: Wired existing-invoice list fetching to fetchInvoicesPaginated with search, status=all, and paging controls.
- (2026-02-09) Completed `F010`: Hooked existing-invoice selection to getInvoiceForRendering detail fetch with in-flight request guarding.
- (2026-02-09) Completed `F011`: Mapped fetched DB invoice detail payloads into Wasm preview model shape via mapDbInvoiceToWasmViewModel.
- (2026-02-09) Completed `F012`: Implemented explicit loading, empty, and error states for existing invoice search and detail loading flows.
- (2026-02-09) Completed `F013`: Added clear action that resets selected existing invoice and clears mapped detail preview state.
- (2026-02-09) Completed `F014`: Implemented dedicated preview workspace UI inside the invoice designer visual workflow shell.
- (2026-02-09) Completed `F015`: Rendered preview on DesignCanvas with the same artboard/ruler/canvas-scale conventions as design mode.
- (2026-02-09) Completed `F016`: Updated preview rendering to resolve field and totals bindings from selected preview dataset before scaffold fallback.
- (2026-02-09) Completed `F017`: Kept scaffold placeholder resolution for missing bound values so previews remain legible with sparse data.
- (2026-02-09) Completed `F018`: Updated totals/totals-row preview rendering to show selected invoice subtotal/tax/total values.
- (2026-02-09) Completed `F019`: Updated table and dynamic-table preview rendering to display selected invoice line items with empty-state fallback.
- (2026-02-09) Completed `F020`: Preview canvas now recomputes from current workspace nodes so metadata/layout edits are reflected in preview.
- (2026-02-09) Completed `F021`: Added debounced node updates in preview mode to reduce recompute churn during rapid editing.
- (2026-02-09) Completed `F022`: Added readOnly canvas mode that disables drag, resize, selection mutation, and other editing affordances in preview.
- (2026-02-09) Completed `F023`: Disabled design-time selection opacity deemphasis behavior in read-only preview mode.
- (2026-02-09) Completed `F024`: Kept existing hydration/reset integration untouched while inserting preview workspace wrapper, preserving load semantics.
- (2026-02-09) Completed `F025`: Preview flow only calls read-side invoice actions and client-side rendering logic, with no template/invoice write paths.
- (2026-02-09) Completed `F026`: New-template preview defaults to sample source/scenario so preview works without tenant invoice history.
- (2026-02-09) Completed `F027`: Added stable automation IDs for preview tabs, source toggles, selectors, pagination, and loading/error/empty states.
- (2026-02-09) Completed `F028`: Added `previewSessionState` unit coverage for default state, source/selector transitions, and list/detail async state handling to lock preview session state behavior.
- (2026-02-09) Completed `F029`: Added preview-binding unit tests to verify real bound data wins and unresolved bindings return `null` for scaffold fallback paths.
- (2026-02-09) Completed `F030`: Added workspace/editor integration tests covering Design->Preview->Design and Visual->Code->Visual loops while preserving unsaved workspace and nested tab state.
- (2026-02-09) Completed `F031`: Existing-invoice integration tests now cover list fetch (`status=all`, paging, query), invoice selection, detail fetch, stale-response guards, and source switching refresh behavior.
- (2026-02-09) Completed `F032`: Updated invoice template docs with the Visual preview workspace flow, source controls, read-only guarantees, and automation-id guidance.
- (2026-02-09) Completed `T001`: `DesignerVisualWorkspace` test coverage verifies secondary `Design` and `Preview` tabs render in Visual mode.
EOF && git add ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace/tests.json ee/docs/plans/2026-02-09-invoice-template-designer-preview-workspace/SCRATCHPAD.md packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.test.tsx packages/billing/src/components/invoice-designer/DesignerVisualWorkspace.tsx && git commit -m "test(T001): cover visual workspace design and preview tabs"- (2026-02-09) Completed `T002`: Visual editor defaults to `Design` on initial load
- (2026-02-09) Completed `T003`: Switching `Design` -> `Preview` -> `Design` preserves unsaved workspace state
- (2026-02-09) Completed `T004`: Switching `Visual` -> `Code` -> `Visual` does not break nested tab state
- (2026-02-09) Completed `T005`: Preview state initializes with valid defaults (source, selection ids, loading/error)
- (2026-02-09) Completed `T006`: Sample fixture module exports at least three scenarios with unique ids
- (2026-02-09) Completed `T007`: Each sample fixture satisfies required preview model fields (header, totals, items)
- (2026-02-09) Completed `T008`: Selecting a sample scenario updates active preview dataset
- (2026-02-09) Completed `T009`: Existing-invoice selector is hidden while source is `Sample`
- (2026-02-09) Completed `T010`: Existing-invoice selector is shown while source is `Existing`
- (2026-02-09) Completed `T011`: Existing invoice search calls paginated fetch with status `all` and expected paging params
- (2026-02-09) Completed `T012`: Existing invoice search applies query text filtering
- (2026-02-09) Completed `T013`: Existing invoice search handles pagination transitions correctly
- (2026-02-09) Completed `T014`: Selecting an existing invoice triggers detail fetch via getInvoiceForRendering
- (2026-02-09) Completed `T015`: Rapidly changing selected existing invoice does not leave stale detail data in preview
- (2026-02-09) Completed `T016`: Detail mapping converts DB invoice payload into preview model numeric/string types correctly
- (2026-02-09) Completed `T017`: Detail mapping handles nullable fields without crashing
