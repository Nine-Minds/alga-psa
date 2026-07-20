# Wave 4b report — Invoicing Hub "Project Billing" tab + client portal billing summary

## Summary

Built the tenant-wide project-billing review queue as a fourth sub-tab in the Invoicing
Hub (F104–F108) and the read-only client-portal billing summary with its MSP-side
`show_billing` toggle (F143–F145). The Hub tab lists every `ready` schedule entry
(project link, client, description, computed amount, readiness trigger, days waiting)
with row actions (Approve; Approve & invoice now — standalone-mode rows only; Hold with a
required-reason dialog; Cancel with a confirm dialog), bulk Approve/Hold over shift-range
selection, and a live count pill on the tab label fed by `getReadyEntryCount()`. Every
mutation reloads the queue and bumps the Hub refresh trigger so the badge stays accurate;
partial-failure results from the bulk actions surface via toast. On the client portal, a
calm read-only "Billing" card renders on the project detail only when the project's
`client_portal_config.show_billing` is enabled and a billing config exists (the action
returns `null`/disabled otherwise, and the component renders nothing). The per-project
`show_billing` switch was added to the shared `ClientPortalConfigEditor`, and `show_billing`
was threaded through the `IClientPortalConfig` type, `DEFAULT_CLIENT_PORTAL_CONFIG`, and the
Zod `clientPortalConfigSchema` (packages + server mirrors) so it persists rather than being
stripped on save.

All strings go through the existing i18n `t(..., { defaultValue })` pattern (msp/invoicing
for the Hub tab, features/projects for the portal), with the Hub keys also added to
`server/public/locales/en/msp/invoicing.json`. Currency uses the shared `useFormatters`
helper; every interactive element carries an `id`. Actions rely on server-side RBAC (the
schedule mutations mirror the invoice-generation permission set; the queue read uses
`billing:read`) exactly like the sibling Invoicing Hub tabs, which are not separately gated
client-side beyond living inside the billing dashboard.

## Files changed

New:
- `packages/billing/src/components/billing-dashboard/invoicing/ProjectBillingReviewTab.tsx` — the review-queue tab (table, row/bulk actions, hold + cancel dialogs, toasts, empty state).
- `packages/client-portal/src/components/projects/ProjectBillingSummarySection.tsx` — read-only portal billing summary (totals + payment schedule, renders null when disabled).

Modified:
- `packages/billing/src/components/billing-dashboard/InvoicingHub.tsx` — added the `project-billing` sub-tab, the `getReadyEntryCount()` fetch, and the count-pill label.
- `packages/ui/src/components/CustomTabs.tsx` — widened `TabContent.label` from `string` to `React.ReactNode` (backward-compatible) so a trigger can carry the inline count pill.
- `server/public/locales/en/msp/invoicing.json` — added `hub.tabs.projectBilling` and the `projectBilling.*` string block.
- `packages/types/src/interfaces/project.interfaces.ts` — added `show_billing?` to `IClientPortalConfig` + `DEFAULT_CLIENT_PORTAL_CONFIG`.
- `server/src/interfaces/project.interfaces.ts` — same field, kept in parity with the canonical type.
- `packages/projects/src/schemas/project.schemas.ts` — added `show_billing` to `clientPortalConfigSchema` (this is the schema `projectActions.updateProject` validates through).
- `server/src/lib/schemas/project.schemas.ts` — same field for parity.
- `packages/projects/src/components/ClientPortalConfigEditor.tsx` — the single allowed component under `packages/projects/src/components/`; added the "Show Billing" switch and a visibility-summary line.
- `packages/client-portal/src/components/projects/ProjectDetailView.tsx` — renders `<ProjectBillingSummarySection>` at the bottom of the detail view.

## Verification

- `cd packages/billing && npx tsc --noEmit -p .` → 1 error, the documented pre-existing `src/actions/quoteActions.ts(32) TS2307` (`@alga-psa/opportunities/lib/quoteLifecycleHooks`). No new errors vs. baseline.
- `cd packages/client-portal && npx tsc --noEmit -p .` → 2 errors, both the same pre-existing TS2307 (`quoteActions.ts` transitively + `client-billing.ts`). Baseline captured before changes was identical (2). No new errors.
- `cd packages/types && npx tsc --noEmit -p .` → 0 errors.
- `cd packages/projects && npx tsc --noEmit -p .` → 0 errors.
- `cd packages/ui && npx tsc --noEmit -p .` → 0 errors (label widening is source-compatible).
- `npx vitest run tests/InvoicingHub.i18n.test.ts` (billing) → passed (T040 heading/tab-label wiring intact with the new key present).
- `npx vitest run src/schemas/__tests__/clientPortalConfigSchema.test.ts src/components/__tests__/ClientPortalConfigEditor.test.tsx` (projects) → 13 tests passed.

## Notes / limitations

- `ReadyQueueRow` (and `ClientProjectBillingSummary`) carry no currency field; the config
  currency is constrained to match the client billing currency, so both UIs format amounts
  as USD via `useFormatters().formatCurrency`. If multi-currency display is required, the
  action contracts would need to expose the config currency — flagged for the backend lane,
  not changed here (contract is locked).
- The project link points to `/msp/projects/{id}`. The billing view is a persisted
  ViewSwitcher preference (owned by the W4a lane) with no URL deep-link today, so there is no
  `?view=billing` param to target; the link lands on the project and the user's saved view.
  If W4a adds a deep-link param, the `href` can be extended.
- Did not edit `features.json` or `SCRATCHPAD.md` (per brief). F104–F108, F143–F145 are
  implemented but their `implemented` flags remain unflipped for the orchestrator to update.
- No files under `packages/projects/src/components/` other than `ClientPortalConfigEditor.tsx`
  were touched; project billing-view components, ProjectDetail/Info/Phases, engine, and
  actions were left untouched.
