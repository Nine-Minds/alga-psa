# Evidence and decisions

- Final mitigation takeover at `642ca29d60`: the three requested remaining repairs are already implemented and independently verified. The unresolved review finding is the manual export fallback regression saved under `/tmp/accounting-mitigation-review-642c`.
- `getXeroDefaultSelection` returns raw absent/unknown outcomes while its export consumer expects a resolved connection; settings and catalogs separately fall back. Resolve usable defaults once in that I/O helper and delegate the ID-only helper to it. Keep ambiguity distinct and prevent realm-less batch persistence.
- Parent remote branch and merge base are both `0af97e5c61`; no local parent branch exists. Parent facts and plan retain home-tenant authentication and MSP ownership of commercial records.

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

## Final mitigation takeover validation

- Shared selection now resolves absent/unmatched saved defaults to the connected Xero default consistently. The ID-only helper delegates to it; ambiguous selections remain unavailable, and disconnected manual exports fail before preview or batch creation.
- New composed selection-to-batch suite: six cases failed before the repair; all ten now pass, covering first use, QBO/stale defaults, selected and historical identities, ambiguity with an explicit override, missing/cross-tenant connections, and QBO routing.
- Current-turn checks: 368 non-DB behavioral tests pass (24 selector tests, 284 accounting/QBO regressions, 49 Xero scope/settings tests, 11 adapter polling tests). Serial isolated DB suites pass 20/20 (8 mapping guards and 12 real export/payment/credit/replay scenarios).
- Integrations, billing and types typechecks pass with a 12 GB Node heap. Billing tsup build passes. Changed-file ESLint has zero errors; existing warnings remain. No live vendor call, full production Next.js build, or new browser smoke run is claimed.
- Existing smoke artifacts and the port-3004 environment are preserved. The temporary `test_xero_final_takeover` database is removed after validation. Parent merge base remains `0af97e5c61` and the board dependency is unchanged. Keep the commit local; do not push or open a PR.
- Review first: the shared `getXeroDefaultSelection` fallback and its composed manual-export regression suite; previous mapping conflict/ambiguity and real financial-write acceptance repairs remain intact.
