# Scratchpad: materials respect allocations (B1)

## Decisions
- Gate placed after `ensureStockLevel` and the `forUpdate` select in `recordStockConsumption`; `held` check precedes the override branch so the flag structurally cannot reach held stock.
- Errors cross server actions as `{stockConflict}` payloads; thrown errors are lost at the boundary.
- Picker badge uses per-location free stock (default location, tenant default fallback) to agree with the location consume locks.
- REST: clean refusal, no override.
- Adjust/retire paths unchanged (correction paths; allow negative on-hand with a warning).

## Gotchas
- DB tests: run `node scripts/run-workspace-db-tests.mjs packages/inventory` with an isolated migrated Postgres; the secrets provider reads `secrets/postgres_password`.
- UI tests run from `server/` with `../packages/...` paths (jsdom). Partial-mock `@alga-psa/ui/lib/i18n/client` via `importOriginal` because `useCurrencyFormat` needs `useOptionalI18n`.
- Avoid `{{count}}` interpolation (plural handling) in new strings.
- The project fixture tenant has no project; the DB test creates one inside the rolled-back transaction.
- Server/billing `tsc` needs `NODE_OPTIONS=--max-old-space-size=14336`.

## Follow-ups (LEVERAGE markers)
- `material-picker-stock-ui`: ticket card and project drawer duplicate the badge, handler and dialog.
- `stock-conflict-action-mapping`: conflict-to-result mapping repeats in tickets, projects and billing actions.
- Override reporting needs a structured column if it is ever reported on.
- Depends on this fix: physical-work-tags plan item C6.
