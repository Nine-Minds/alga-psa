# Client portal invoice template selection

- Ticket: alga-2026-0002528
- Date: 2026-09-21
- Status: proposed
- Inspected revision: `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04`

## Problem and outcome

The client portal invoice preview picks a standard template even when a client override or tenant default selects a custom template. Recipients therefore see a different invoice design from the MSP preview and newly generated PDF. Use the existing invoice template resolver to choose the portal preview's template.

The primary user is a client portal contact with billing read access opening an eligible invoice. MSP administrators configure invoice templates through the existing settings. No new controls or settings are needed.

## Verified code paths

Paths below are relative to the repository root.

| Path and symbol | Current behavior |
| --- | --- |
| `packages/client-portal/src/components/billing/ClientInvoicePreview.tsx`, load effect and template selection around lines 70–106 | Loads invoice data and templates in parallel, then chooses `templates.find(t => t.isStandard) || templates[0]`. |
| `packages/client-portal/src/actions/client-portal-actions/client-billing.ts`, `getClientInvoiceTemplates` around line 806 | Checks client context and billing permission, then returns both standard and tenant templates. The custom template is already available to the component. |
| `packages/billing/src/actions/invoiceQueries.ts`, `getResolvedInvoiceTemplateId` around line 856 | Returns the client's `invoice_template_id`, otherwise the tenant default, otherwise the first template; returns null for absent/denied invoices. |
| Same file, `assertClientPortalInvoiceAccess` around line 59 | Checks portal client ownership and excludes draft invoices using tenant-scoped queries. Resolver also requires billing read permission. |
| `packages/billing/src/models/invoice.ts`, `getAllTemplates` around line 912 | Produces standard and tenant templates; derives default flags from the tenant's `invoice_template_assignments` row. |
| `packages/billing/src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx`, load effect around line 186 | Calls the resolver and matches its ID, while allowing an explicit MSP template selection to take precedence. |
| `packages/billing/src/services/pdfGenerationService.ts`, `resolveInvoiceTemplateId` around line 841 | Independently implements the same client/default/first preference for new renders. It does not call the server action directly. |
| `packages/client-portal/src/actions/client-portal-actions/client-billing.ts`, `downloadClientInvoicePdf` around line 862 | Serves a published PDF when available, so an older download can intentionally differ from a preview using current settings. |

## Implementation

### F001: Resolve the configured template

In `ClientInvoicePreview.tsx`, import `getResolvedInvoiceTemplateId` from `@alga-psa/billing/actions/invoiceQueries`. Add `getResolvedInvoiceTemplateId(invoiceId)` to the existing `Promise.all` alongside invoice data and template retrieval. After existing error checks and invoice mapping, select the template whose `template_id` equals the resolved ID.

Keep resolution server-side. Do not read client configuration in the component or reproduce preference queries in a new portal action. The component already reuses billing presentation and adapters under an explicit cross-feature import exception; update its explanation if necessary to cover this scoped billing reader.

### F002: Preserve fallback and failure behavior

Use this selection order:

1. Template matching the resolved ID.
2. First standard template.
3. First available template.
4. Null when the list is empty, preserving the existing unavailable state.

Both a null ID and an ID absent from the returned list use the fallback. A rejected resolver request follows the existing localized load-failure path; do not silently treat a request failure as an unconfigured preference. Preserve invoice/template action-error checks before rendering. A null resolver result must never override an invoice access denial from `getClientInvoiceById`.

Replace the obsolete comment suggesting tenant defaults are future work. Keep the current renderer, invoice mapping, loading state, and UI structure.

### F003: Resolve on invoice changes

Keep `invoiceId` in the effect dependencies and call the resolver with the current invoice ID on each load. Verify a completed load followed by a different invoice selects the second invoice's resolved template. General cancellation/race hardening is outside this defect's scope; the existing portal effect has no cancellation guard.

## Files to change

- `packages/client-portal/src/components/billing/ClientInvoicePreview.tsx`: action import, parallel fetch, matching selection, and explanatory comment.
- New `packages/client-portal/src/components/billing/ClientInvoicePreview.templateSelection.test.tsx`: behavior tests observing the template passed to `TemplateRenderer`.
- `packages/client-portal/src/components/billing/ClientInvoicePreview.servicePeriods.test.tsx`: mock the new resolver and retain its current invoice-data assertions.
- Proposed `server/src/test/unit/billing/invoiceQueries.templateResolution.db.test.ts`: a small suite exercising the reused resolver against a migrated test schema with portal user context. Reuse equivalent existing DB coverage if found during implementation.

No changes are expected in the resolver, template-list action, invoice model, MSP preview, PDF generator, schema, or package manifests.

## Acceptance and validation

The companion `tests.json` tracks implementation of the checks; all entries remain false until implemented.

- Component tests: with a standard template first and multiple custom templates present, a resolved custom ID reaches the renderer. Parameterize representative client-override and tenant-default results. Confirm the resolver receives the invoice ID.
- Component tests: null or unknown ID falls back to standard, then first available when there is no standard; an empty list shows unavailable. Include a resolved non-first standard template so ID matching is not limited to custom templates.
- Component tests: resolver rejection displays the existing load error; invoice or template action errors do not render invoice content. Confirm selection updates after a completed load and invoice prop change.
- DB sanity suite: exercise the real resolver queries against migrated schema. For an authorized portal user and finalized invoice, verify client override wins over a distinct tenant assignment, then removing the override yields the assignment. Create the assignment in `invoice_template_assignments`, not legacy default fields. Guard cases must return null for another client's invoice, a draft, and an invoice outside the authenticated tenant. Authentication may be supplied by a test harness; do not mock query results or the access helper.
- Run the existing service-period component test with the new resolver mocked. Its invoice view-model assertions must continue passing.
- Manual smoke: use distinct visible designs for tenant default and client override. Open the eligible invoice through client portal billing, compare to the MSP preview without an explicit template override, and compare to a fresh PDF generated under the same settings. Clear the client override and reopen to check the tenant default; remove the tenant assignment and verify the existing fallback. Do not use an old published PDF to assert current-settings equality.

Application tests and browser checks are future implementation validation, not completed design-session evidence.

## Deliberately out of scope

- Template editing, assignment UI, migrations, or changed default precedence.
- Refactoring the duplicate PDF resolution logic or changing published PDF storage/download semantics.
- Exact rendering parity: location enrichment, PDF standard-template auto-switching for multiple locations, annotations, page sizes, scaling, localization, or print settings.
- A portal template picker, new permissions, changed authorization, feature flags, or new telemetry.
- General effect cancellation and unrelated component cleanup.

## Risks and limits

- The new read adds server work to each preview load. Running it alongside existing reads avoids an intentional sequential request waterfall.
- Missing/deleted template references fall back in the portal as requested. PDF rendering can behave differently for a missing template; repairing stale configuration is outside scope.
- Resolver null covers both no result and denial. Existing scoped invoice retrieval remains the decisive rendering gate; retain it and verify guard behavior.
- The portal currently uses fixed dimensions. Selecting a custom template does not fix clipping or print-format differences.
- Published PDFs preserve an earlier issued document. Template changes after issuance do not imply that download and current preview should be rewritten to match.
- A new server-action import can expose missing test mocks or dependency-boundary issues. Use the existing billing action subpath and verify the component through the actual portal route.
- Rapid invoice changes can expose the pre-existing uncancelled effect race. Record a reproduction separately if observed; do not expand the change without revisiting scope.

## Rollout and open questions

Deploy with the ordinary application release; no data migration or flag is needed. Reverting the component change restores the prior selection behavior. No product clarification is required for the proposed scope. Confirm the isolated DB test fixture/harness during implementation and record any validation blocker.
