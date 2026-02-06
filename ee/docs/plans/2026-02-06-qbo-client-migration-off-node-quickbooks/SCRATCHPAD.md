# Scratchpad — QBO client migration off node-quickbooks

- Plan slug: `qbo-client-migration-off-node-quickbooks`
- Created: `2026-02-06`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-02-06) Primary migration target is an internal REST-based QBO client inside `QboClientService`, not another community wrapper. Rationale: we only use a narrow operation set and can remove the largest dependency risk surface fastest.
- (2026-02-06) Execute in two commits/batches: Batch 1 parity implementation + compile/typecheck validation, Batch 2 dependency removal + lockfile/audit verification.
- (2026-02-06) Per user instruction, skip new test authoring/execution for now and validate via typechecks/compiles only.
- (2026-02-06) Batch 2 removes `node-quickbooks` from both `packages/integrations` and `server` manifests/lockfiles because both declarations contributed risk even though runtime usage had already been removed.

## Discoveries / Constraints

- (2026-02-06) Current `node-quickbooks` usage is concentrated in `packages/integrations/src/lib/qbo/qboClientService.ts`; app call sites are mostly `qboActions.ts` and `quickBooksCompanyAdapter.ts`.
- (2026-02-06) Existing behavior to preserve includes: `query`, `create`, `update`, `read`, `findCustomerByDisplayName`, `createOrUpdateCustomer`, and token refresh with tenant secret updates.
- (2026-02-06) `node-quickbooks` latest npm version is `2.0.47` (modified `2025-12-06`) and includes `request@2.88.0` in dependencies.
- (2026-02-06) `quickbooks-node-promise` latest npm version is `3.3.14` (modified `2025-02-03`). It is a possible fallback option but not selected as primary path.
- (2026-02-06) `intuit-oauth` latest npm version is `4.2.2` (modified `2025-11-10`) and can remain relevant for OAuth flows, but this migration targets data API calls in client service.
- (2026-02-06) `server/package.json` also declares `node-quickbooks` even though no active imports were found in server source; batch 2 should remove this as part of dependency cleanup.
- (2026-02-06) After lockfile cleanup, `npm ls node-quickbooks --all` returns empty at both monorepo root and server package.

## Commands / Runbooks

- (2026-02-06) Find QBO usage surface:
  - `rg -n "quickbooks|node-quickbooks|intuit|qbo" packages/integrations/src/lib/qbo/qboClientService.ts packages/integrations/src/actions/qboActions.ts packages/billing/src/services/companySync/adapters/quickBooksCompanyAdapter.ts packages/integrations/package.json`
- (2026-02-06) Inspect npm package metadata:
  - `npm view node-quickbooks version time.modified repository.url dependencies --json`
  - `npm view quickbooks-node-promise version time.modified repository.url dependencies --json`
  - `npm view intuit-oauth version time.modified repository.url dependencies --json`
- (2026-02-06) Inspect repo activity quick check:
  - `curl -s https://api.github.com/repos/mcohen01/node-quickbooks | rg -n '"pushed_at"|"open_issues_count"'`
  - `curl -s https://api.github.com/repos/pbrink231/quickbooks-node-promise | rg -n '"pushed_at"|"open_issues_count"'`
- (2026-02-06) Validate compile/typecheck only (no tests):
  - `npm -w packages/integrations run typecheck`
  - `npm -w packages/billing run typecheck`
  - `npm -w server run typecheck`
- (2026-02-06) Remove vulnerable dependency entries and refresh lockfiles:
  - `npm uninstall -w packages/integrations node-quickbooks --legacy-peer-deps`
  - `npm uninstall -w server node-quickbooks --legacy-peer-deps`
  - `npm --prefix server uninstall node-quickbooks --legacy-peer-deps`
  - `npm install --package-lock-only --legacy-peer-deps`
  - `npm prune --legacy-peer-deps`
- (2026-02-06) Verify dependency removal:
  - `npm ls node-quickbooks --all || true`
  - `npm --prefix server ls node-quickbooks --all || true`

## Links / References

- Plan files:
  - `ee/docs/plans/2026-02-06-qbo-client-migration-off-node-quickbooks/PRD.md`
  - `ee/docs/plans/2026-02-06-qbo-client-migration-off-node-quickbooks/features.json`
  - `ee/docs/plans/2026-02-06-qbo-client-migration-off-node-quickbooks/tests.json`
- Key code:
  - `packages/integrations/src/lib/qbo/qboClientService.ts`
  - `packages/integrations/src/actions/qboActions.ts`
  - `packages/billing/src/services/companySync/adapters/quickBooksCompanyAdapter.ts`
- External packages:
  - `https://www.npmjs.com/package/node-quickbooks`
  - `https://www.npmjs.com/package/quickbooks-node-promise`
  - `https://www.npmjs.com/package/intuit-oauth`
  - `https://github.com/mcohen01/node-quickbooks`
  - `https://github.com/pbrink231/quickbooks-node-promise`
  - `https://github.com/intuit/oauth-jsclient`

## Open Questions

- Do we keep a temporary fallback path to legacy SDK for one release, or hard-cut to REST implementation immediately?
- Should update payloads enforce sparse update semantics globally?
- Is explicit `minorversion` support required now, or can it be deferred?
