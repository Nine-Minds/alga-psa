# Evidence and decisions

- Parent plan: `docs/plans/2026-09-06-co-managed-it-plan.md`; accounting actions use narrow `accounting_integrations` capabilities and tenantDb. Parent changes are already ancestors of this branch.
- At b18e974403 the Xero settings slot still loaded global-default health and `ran: true` was mistaken for successful completion. Reproductions are saved outside the repository under `/tmp/accounting-round3-review`.
- Fixed page caps with cursor preservation prevent loss but cannot make progress through a permanently larger result set. Xero supports numbered pages, so exhaust them and reject repeated pages instead of moving the timestamp.
- Preserve unrelated package-lock and migration-cli worktree changes. DB tests recreate a database; run serially using isolated test DB configuration where supported. No live Xero calls are part of this validation.

## Validation

- Focused regression run: 324 accounting, QBO simulator, Xero HTTP boundary, scheduler and UI tests passed across 36 files. Final action/translation run: 8 passed, including explicit QBO realm selection.
- Xero integration suite: 11 passed against `test_accounting_takeover`; includes real export, AR/ledger writes, drift without line replacement, allocation replacements, injected transactional failure/replay, and realm-scoped exception counts.
- Types, integrations and billing `tsc --noEmit` pass with `NODE_OPTIONS=--max-old-space-size=12288`. The default 4GB Node heap exhausted during initial typechecking. Billing `npm run build` passes. No full production Next.js build was run during takeover.
- Billing DB harness now supports `TEST_DB_NAME` (restricted to `test_` names) because another worktree reset the old shared `test_database` during validation. Serial billing suites rerun with `test_accounting_takeover_billing`.
- `stackOnProjectId` still points to the Co-Managed IT parent, and `0af97e5c61` remains an ancestor. Do not push or open a PR.

- Final isolated billing DB checks: Xero fail-closed 2/2, payment reconciliation 5/5, cycle repository 2/2, mapping/realm 8/8. Together with integration 11/11, all 28 DB checks pass. Final changed-file lint: zero errors (existing/style warnings remain). Billing typecheck rerun passes after the final action and test-helper changes.
- Review first: provider-scoped settings composition/health action, Xero `collectChanged`, and the DB replacement failure/replay test. Xero outbound payment/credit/void remain intentionally unsupported and observable through capability gates.
