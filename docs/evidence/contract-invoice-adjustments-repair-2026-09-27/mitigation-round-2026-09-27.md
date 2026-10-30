# Contract invoice adjustments mitigation round

## Baseline and workspace

- The checkout began at `8fdbaf04c46241722c9011fa52b4f2e32c6b735f`, matching
  the reported prior head and `origin/feature/contract-invoices-automatic-adjustments-and-disc`.
- The tracked root setup uses npm workspaces in `package.json` and a tracked
  `package-lock.json`. Two untracked root files, `pnpm-lock.yaml` and
  `pnpm-workspace.yaml`, selected pnpm for Nx. The workspace file contained only
  pnpm `allowBuilds` entries and no package globs. Nx then tried to fetch local
  `@alga-psa/*` packages, including `@alga-psa/types`, from the public registry
  (`ERR_PNPM_FETCH_404`). It also stopped on `ERR_PNPM_IGNORED_BUILDS` for
  `esbuild`.
- `node_modules/@alga-psa/types` was a local symlink to `packages/types`, and
  `npm ls @alga-psa/types --depth=0` showed the internal workspace graph.
- The untracked pnpm files were archived outside the worktree at
  `/tmp/contract-invoice-pnpm-lock.yaml.pre-repair` and
  `/tmp/contract-invoice-pnpm-workspace.yaml.pre-repair`, then removed from the
  workspace. This is local environment restoration. No pnpm config or
  dependency artifacts were committed, and build-script protections were not
  disabled.
- After removing the conflicting pnpm selectors, `npx nx build-deps server
  --skip-nx-cache` succeeded across 58 dependency tasks. The billing package
  build also succeeded.

## Development database migrations

The target was verified from `.env.localtest` and Docker labels as database
`server` in compose project `alga-psa-local-test`, PostgreSQL host port 5472.
PgBouncer is on 6472. No command used port 5432.

Knex's normal migration status/list operation refused to run because the live
ledger contains many applied historical migration names whose files are absent
from this checkout, including companion migration
`20260927120000_contract_recurring_mid_period_adjustments.cjs`. Before applying
anything, direct ledger and schema inspection showed:

- None of branch migrations `20260927010000` through `20260927070000` were
  recorded.
- `contract_discount_assignments` and
  `contract_template_discount_copies` did not exist.
- `client_contracts` had 36 rows; `contract_line_discounts` had 3 rows;
  `discounts` had 3 rows; `invoices` had 61 rows and `invoice_charges` had 74.
- The database is plain PostgreSQL. `pg_dist_partition` is absent.

Because the ledger was too incomplete for Knex's normal runner, each of the
seven checked-in migration modules was executed in filename order through
`migration.up(trx)` inside its own transaction. Its `knex_migrations` row was
inserted in that same transaction, batch 54. All seven completed. Post-migration
checks confirmed:

- The two new tables exist. Assignments and template-copy ledger rows are both
  zero because neither table existed before migration.
- `contract_discount_assignments` has primary key `(tenant, assignment_id)`,
  unique key `(tenant, client_contract_id, discount_id)`, and the client-contract
  lookup index. Its tenant, discount, and client-contract foreign keys are
  validated and cascade on delete.
- `contract_template_discount_copies` has primary key
  `(tenant, client_contract_id, template_discount_key)`, unique key
  `(tenant, discount_id)`, and validated cascading foreign keys to discounts
  and client contracts.
- All 3 existing line-discount rows now have client-contract ownership. Their
  tenant-aware foreign key to `client_contracts` cascades on delete. No shared
  assignment definitions or orphan assignment owners were found.
- The invoice and charge counts remained 61 and 74. The migrations do not
  rewrite invoice rows or settlement identities.
- The migrations' Citus distribution ordering and colocation code was not
  changed. This local plain-PostgreSQL run does not independently verify Citus;
  the Citus sandbox evidence is in `implementation-evidence.md`.

## Regression and build checks

Executed on this worktree:

- Nx workspace dependency build: 58 tasks passed.
- Billing package build: passed.
- Evaluator and line-item component tests: 38 passed across 3 files.
- Wizard action, resume, bucket-pool, protected-history, and line-window tests:
  34 passed across 5 files.
- `contractInvoiceAdjustments.db.test.ts`: 41 passed on isolated database
  `test_contract_invoice_repair_20260927` at port 5472.
- `contractDiscountAssignmentsClientScopeMigration.integration.test.ts`: 5
  passed on isolated database `test_contract_discount_migration_repair_20260927`
  at port 5472. The two DB suites ran sequentially.
- Billing typecheck completed with 11 diagnostics. They are confined to
  unchanged `profitabilityReportActions.ts` and shared UI editor files, matching
  the prior handoff baseline. Typecheck is not clean.
- No UI text changed in this mitigation, so localization checks were not rerun.

## Live smoke status

The saved service definition is `HOST=0.0.0.0 PORT=3185 npm run dev` from the
worktree's `server` directory. Startup was attempted only through
`alga-dev workflow-ensure-service`. Nx dependency builds pass independently,
but the workflow service manager suspended the PTY within a fraction of a
second, recording `"Draft Implementation" does not use it`. Port 3185 never
bound, and `http://localhost:3185/api/health` returned connection refused. A
temporary supervised invocation captured only the npm script header before
the same suspension. The registered service was restored to its original
command afterward.

No current-head invoice or template page was reachable. The fixture was queried
before any smoke mutation. `SMOKE-ADJ-1` exists as draft invoice
`5a1e0000-0000-4000-8000-0000000000a1`, but it is not in the documented
canonical state: it has five charge rows (including an extra `$100` catalog
line and a `-$30` manual credit), subtotal `$3,705`, tax `$9`, total `$3,714`,
and a `-$415` automatic discount. No fixture rows were changed during this
round. Because the service did not stay up, the fixture was not reseeded or
restored; its pre-existing drift remains to be reconciled during a live smoke.
Existing screenshots, PDFs, and smoke records under
`docs/evidence/b97eda7b-contract-invoice-adjustments/` are historical context,
not evidence for this mitigation. Fresh screenshots, editor add/edit/repeat-save/
remove flows, discount and tax paths, template copy targeting, lifecycle UI,
preview/PDF parity, portal output, accounting export, and combined companion
acceptance remain outstanding. No invoices were sent and no external accounting
system was contacted.

The companion writer was not changed or merged. Existing database regression
coverage exercises a fabricated detail-free `contract_change` ledger row for
source resolution and overlap protection; this does not prove companion
end-to-end acceptance.
