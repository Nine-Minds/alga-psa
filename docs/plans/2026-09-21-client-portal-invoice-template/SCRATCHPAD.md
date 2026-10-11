# Client portal invoice template notes

- Ticket: alga-2026-0002528.
- Inspected base: `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04` on 2026-09-21.
- The portal loads all templates, but explicitly prefers a standard template. The existing billing resolver already implements the required preference and portal access checks.
- `Invoice.getAllTemplates` derives default flags from `invoice_template_assignments`; reuse the resolver without adding legacy default-column queries.
- The current component test mocks only the two portal actions. Add a mock for the billing resolver to avoid loading its server dependency graph in jsdom.
- The portal download action serves a previously published PDF when available. Compare a fresh fixture with unchanged template settings when checking selection across surfaces.
- Scope is three observable behaviors, tracked in features.json. No application code or tests were changed during design.
- Existing unrelated `package-lock.json` modifications must remain outside the plan commit.
- Environment limitation during design: the worktree's Btrfs volume reported zero available data space; Git status with index refresh failed with an out-of-disk-space error. `/tmp` is on a separate volume with available space. Preserve the plan there if the intended worktree write fails. Do not modify the running development server's cache to make space.

## Validation commands for implementation

From `packages/client-portal`, run `npx vitest run src/components/billing/ClientInvoicePreview.templateSelection.test.tsx src/components/billing/ClientInvoicePreview.servicePeriods.test.tsx`.

From `server`, run the proposed database suite with `npx vitest run --config vitest.workspace-db.config.ts src/test/unit/billing/invoiceQueries.templateResolution.db.test.ts`. Use a dedicated test database: this runner's setup can recreate `test_database`; do not target the shared development database.

Run focused lint/type validation for the changed component and tests using the repository configuration. Record any baseline or environment failures separately from regressions.
