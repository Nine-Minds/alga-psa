# Scratchpad — Project Billing

## Key artifacts

- Design doc (approved): `docs/plans/2026-07-15-project-billing-design.md`
- Mockups: `docs/plans/2026-07-15-project-billing-mockups/` — **option-3-view.html is the chosen direction** (billing as third ViewSwitcher view) + option 1's metadata-row billed bar
- Branch: `feature/project-billing` (design work committed on worktree branch `worktree-project-billing-design`)

## Decisions (and rationale)

- **Engine-first architecture (Approach A):** project billing is a first-class charge source in `billingEngine.ts`, NOT a hidden contract nor a parallel subsystem. Requirements (fixed-price time exclusion, caps, overrides) force engine changes anyway; same pattern as materials/buckets/licenses. Everything downstream (tax/credits/invoicing/export) unchanged.
- **Standalone, contract optional:** a project bills without a contract; `contract_id` on the config is only rate-card/terms inheritance.
- **Review queue is mandatory** (no auto-bill on readiness) — matches existing approval-gated culture (time approval, recurring blockers).
- **Milestones = payment schedule entries**, optionally linked to phases — NOT "phases are milestones" (payment terms decoupled from WBS; 50/25/25 shouldn't force 3 phases).
- **Cap behavior configurable per project:** notify-only vs hard cap (write-down, never negative billing).
- **Phase completion is explicit** (`project_phases.completed_at` + PM action) — phases only have a freeform `status` string today; do NOT infer completion from it. Task statuses have `is_closed` via `project_status_mappings`; use all-tasks-closed only as a nudge.
- **UI = third view, not a tab:** the project screen has NO tabs (ProjectInfo header over ProjectDetail board). ViewSwitcher (`@alga-psa/ui/components/ViewSwitcher`, pref `PROJECT_VIEW_MODE_SETTING`, currently `'kanban' | 'list'`) gains `'billing'`, RBAC-gated.
- Rounding: percentage entries computed in cents; remainder assigned to final entry so schedule sums exactly (T005/F035).

## Codebase discoveries

- `billingEngine.ts` is ~4,400 lines; charge calculators are per-type methods called from `calculateBilling()` per client. Time query already joins `project_tasks → project_phases → projects` AND `tickets` (around line 3156).
- `getClientIdForWorkItem` in `packages/billing/src/lib/contractLineDisambiguation.ts:347` resolves project_task → client.
- Bucket pattern to mirror for cap usage: `bucket_usage` table + `packages/billing/src/services/bucketUsageService.ts`, FOR UPDATE locking during invoice persistence.
- Materials precedent for cross-package UI: `packages/projects/src/components/ProjectMaterialsDrawer.tsx` calls billing/inventory actions; materials marked `is_billed` + `billed_invoice_id` in `invoiceGeneration.ts` (~line 2379).
- Charge type union: `packages/types/src/interfaces/billing.interfaces.ts:60` `type ChargeType = 'fixed' | 'time' | 'usage' | 'bucket' | 'product' | 'license'`.
- Project header: `packages/projects/src/components/ProjectInfo.tsx` (line 1: back nav + number + h1 + tags + outline buttons incl. Materials; line 2: Client/Contact/Budget-hours bar). Billed bar goes here.
- Phases panel: `packages/projects/src/components/ProjectPhases.tsx` (styles module); $ badges go on phase rows.
- ViewSwitcher usage: `ProjectDetail.tsx` ~lines 242-266 (`ProjectViewMode`, user-pref persisted, default 'kanban').
- Test conventions: colocated `*.contract.test.ts` next to actions (see `packages/projects/src/actions/`); Playwright + integration suites have dedicated skills (`integration-testing`, `playwright-testing`).
- `docs/billing/billing.md` is the billing vocabulary doc — contracts → contract lines → client contract lines. Vocabulary shifted away from "billing plans"; don't reintroduce.
- Existing notification precedent: `milestoneCompleted` email template family under `server/migrations/utils/templates/email/projects/`.
- ~835 migrations in `server/migrations/*.cjs`; EE citus parity migrations live in `ee/server/migrations/citus/`.

## Gotchas

- **Passthrough guarantee is the #1 regression risk:** projects without configs must bill byte-identically (T021 golden test). Keep all engine changes behind "config exists" joins/guards.
- `billing_model` immutable once any entry invoiced; `total_price` edits must re-validate the schedule.
- Currency on config must match client billing currency (multi-currency service prices exist — `service_prices`).
- Deposit-as-credit must reuse `creditActions` (expiration/reconciliation already handled there); do not hand-roll credit rows.
- Un-finalize must revert entry status AND cap usage in the same transaction (T023).
- Recurring runs must not pick up standalone-mode entries (F069) — easy to miss in the client-scoped engine query.

## Open questions

- Stale-ready warning threshold: default 7 days (make tenant-configurable only if asked).
- Milestone badges for T&M phases: v1 only shows badges where schedule entries link phases.

## Runbook

- Dev stack: `alga-env-dev` / `alga-dev-env-manager` skills (worktree-built images).
- Plan validation: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-07-15-project-billing/`.
