# REST entity tag 500 investigation record

This records the bounded investigation for YourColo and `alga-2026-0002687`. The approved design is
[`2026-11-01-tag-entity-42703-spec.md`](./2026-11-01-tag-entity-42703-spec.md).

## Evidence and limits

- The local migration-built database and the API-key route integration test support the current
  `tag_definitions.board_id` and `tag_mappings.created_by` read-back fields. The route-level test
  creates a tenant-scoped ticket, tags it, reads it back, and compares the returned values with the
  mapping and definition rows. This establishes current-schema behavior only.
- Migration `20250702000000_normalize_tags_with_mappings.cjs` creates `tag_mappings.created_by` and
  originally stores tag scope as `tag_definitions.channel_id`. Migration
  `20250930000001_rename_channels_to_boards.cjs` adds/copies `tag_definitions.board_id` during its
  up path; its down path restores `channel_id` and removes `board_id`. These files show the current
  repository migration history, not which migrations ran on YourColo's appliance.
- `git tag --list 'v1.6.*'` returns only `v1.6.0`; this checkout has no v1.6.9 Git tag or appliance
  migration ledger. The customer database and its applied migration history are not available here.
- Loki was queried for the affected customer/ticket on 2026-11-01 18:00–21:00 UTC. The customer and
  ticket selectors returned only the ticket-comment notification subjects at 19:59:58–19:59:59 UTC.
  The same window returned no `Undefined database column (42703)` or entity-tag route lines. The
  notification log contains no comment body or database error. Therefore the customer failure's
  exact column and root cause remain unresolved; no migration is justified by this evidence.
- Follow-up Loki queries covered the reported October 12–13 dates and the October 22 confirmation
  window. `{namespace="msp",container="sebastian"}` returned app logs and YourColo ticket
  notification subjects on each date, across the hosted blue and green `sebastian` pods. This
  establishes that those dates are retained and that the selector includes the hosted YourColo
  application stream. It does not establish access to a separate customer appliance, nor that an
  API request/error was logged. No `/api/v1/tags/entity` or `INTERNAL_CONFIGURATION` lines matched
  in these windows.
- The Oct 12–13 selector returned five 42703 entries, but their SQL messages identify unrelated
  queries: `contract_lines.created_by` (Oct 12 14:54:24 UTC), `service_catalog.currency_code`
  (Oct 13 10:40:22 and 10:40:40 UTC), and `contract_lines.updated_by` (Oct 13 12:29:16 and
  12:29:27 UTC). The Oct 22 query returned zero 42703 entries. These do not identify the YourColo
  tag failure column. Structured `table`/`column` fields were undefined for these logs; the names
  above came from the SQL error messages.
- Other ticket-tagging entry points are separate: `TicketService.createTicket` and
  `TicketService.updateTicket` accept optional `tags` and call `handleTags`, but that helper is
  currently a placeholder that logs and skips normalized tag writes. No evidence connects those
  no-op paths to this REST entity-tag 500, so they are recorded for follow-up rather than changed
  here.
- The app server was not started. The customer defect was not reproduced against the appliance.
  The previous `stack-up` report (`exit 7: no output`) remains undiagnosed: no originating command
  output or matching stack-up log was available to establish its cause.

## Reproduction commands

Run from `server/` with the migrated integration database available:

```sh
TEST_DB_NAME=tag_entity_repair_test npx vitest run \
  src/test/integration/api/tagEntityRoute.integration.test.ts \
  src/test/integration/api/tagService.replaceEntityTags.integration.test.ts \
  src/test/unit/api/apiMiddleware.productAccess.test.ts \
  --coverage.enabled=false --maxWorkers=1
```

Read Loki without starting the app server. Keep the port-forward process running in one terminal,
then run the query command in another. The selectors and UTC interval below match the investigation:

```sh
kubectl -n loki port-forward svc/loki-loki-distributed-gateway 18101:80

for term in 'YourColo' 'alga-2026-0002687' 'Undefined database column (42703)' '/api/v1/tags/entity'; do
  curl -fsSG 'http://127.0.0.1:18101/loki/api/v1/query_range' \
    --data-urlencode "query={namespace=\"msp\", container=\"sebastian\"} |= \"$term\"" \
    --data-urlencode "start=$(date -u -d '2026-11-01 18:00:00' +%s)000000000" \
    --data-urlencode "end=$(date -u -d '2026-11-01 21:00:00' +%s)000000000" \
    --data-urlencode 'limit=30' --data-urlencode 'direction=forward'
done
```

The additional historical windows were queried with these exact UTC bounds and selector. The
YourColo/ticket positive-control queries show the hosted customer stream was present in the selected
namespace/container on those dates; limits are 100 lines per query, so this is a bounded diagnostic
query rather than a completeness guarantee.

```sh
for window in \
  '2026-10-12 00:00:00|2026-10-14 00:00:00' \
  '2026-10-22 00:00:00|2026-10-23 00:00:00'; do
  start=${window%%|*}
  end=${window##*|}
  for term in 'YourColo' 'alga-2026-0002687' 'Undefined database column (42703)' 'INTERNAL_CONFIGURATION' '/api/v1/tags/entity'; do
    curl -fsSG 'http://127.0.0.1:18101/loki/api/v1/query_range' \
      --data-urlencode "query={namespace=\"msp\",container=\"sebastian\"} |= \"$term\"" \
      --data-urlencode "start=$(date -u -d "$start" +%s)000000000" \
      --data-urlencode "end=$(date -u -d "$end" +%s)000000000" \
      --data-urlencode 'limit=100' --data-urlencode 'direction=forward'
  done
done
```

Observed results: Oct 12–13 produced YourColo/ticket notification matches, five unrelated 42703
entries, and no tag-route or `INTERNAL_CONFIGURATION` matches. Oct 22 produced YourColo/ticket
notification matches, zero 42703 entries, and no tag-route or `INTERNAL_CONFIGURATION` matches.
The exact column for the reported failure still requires the original failed request's UTC timestamp
and trace/request identifier (or full server error/access log), plus confirmation of the deployment
pod/namespace. To determine schema drift, obtain the affected database's `tag_mappings` and
`tag_definitions` columns from `information_schema.columns` and its applied migration ledger
(`knex_migrations`) around the v1.6.9 deployment. Neither the customer database nor its migration
ledger is available in this checkout. The local repository has only a `v1.6.0` tag, not v1.6.9.

Check local release and migration availability with:

```sh
git tag --list 'v1.6.*'
git log --all --format='%h %ad %s' --date=short -- \
  server/migrations/20250702000000_normalize_tags_with_mappings.cjs \
  server/migrations/20250930000001_rename_channels_to_boards.cjs
```

## Code and route checks

- `POST`, `bulk/tag`, and `PUT` replacement read back through `TagService.tagEntityInTransaction`;
  untagging deletes a tenant-scoped mapping. The read-back join and selected columns now have one
  description in `TagMapping.getByMappingId`.
- PUT uses transactional `TagService.replaceEntityTags`. The service uses a savepoint so a caught
  insertion/read-back exception also restores mappings when the caller supplied an existing
  transaction.
- Current tag-definition board scope from the REST schema is honestly `null` (the request schema
  has no board ID field). The integration assertion compares that scope across REST responses and
  the persisted definition. Mapping creator and colors are compared with the database rows.
- The 42703 middleware behavior is exercised with a PostgreSQL-shaped error: public response is
  `INTERNAL_CONFIGURATION`, while the server log retains table and column diagnostics.

## Verification results

- Re-ran the focused command above for this work order. All 3 files and 13 tests passed against the
  isolated migration-built test database. The REST POST→GET, bulk/tag, PUT replacement, rollback of
  failed replacement, schema-contract, and middleware cases passed on the repository schema. This
  does not establish which column is absent on YourColo's v1.6.9 database, and no regression test
  against that affected schema could be run without its schema or migration ledger.
- Scoped ESLint completed with 0 errors and 88 warnings, matching the existing controller/service
  warnings. A scoped `tsc` check for the changed production modules completed with no diagnostics.
- The root `npm run build:source` completed successfully, generated all 74 static pages, and skipped
  type validation. It emitted existing broad dynamic-filesystem tracing warnings. The server-only
  `npm run build:source` command is undefined; the build script exists at the repository root. The
  full server typecheck was not rerun because its previous attempt exhausted Node's 4 GB heap; the
  scoped check above is separate and does not replace it.
- Read-only cluster metadata shows the generic `sebastian` deployment scaled to zero and the
  `alga-psa-vs` routes using blue/green services. This does not identify whether the failed v1.6.9
  request came through hosted production or a customer appliance.

- The focused command above passed: 3 test files, 13 tests.
- `npx eslint packages/tags/src/models/tagMapping.ts server/src/lib/api/controllers/ApiTagController.ts server/src/lib/api/services/TagService.ts server/src/test/integration/api/tagEntityRoute.integration.test.ts server/src/test/integration/api/helpers/withRolledBackSchemaContract.ts server/src/test/unit/api/apiMiddleware.productAccess.test.ts` completed with 0 errors and 88 warnings. The warnings are unused imports/parameters, `any`, and non-null assertions in the existing controller/service files; the added helper/model/test lines emitted no warning.
- `npm run typecheck` from `server/` was attempted and failed when Node reached its 4 GB heap limit (`FATAL ERROR: Reached heap limit`).
- `NEXT_TELEMETRY_DISABLED=1 npm run build:source` compiled successfully and generated all 74 static pages. Next reported that it skipped type validation; the explicit typecheck above remains the type-validation result.
- A scoped TypeScript check covering the changed production modules passed with no diagnostics:
  `npx tsc --project /tmp/tag-route-tsconfig.json --pretty false` from `server/`. That temporary
  config extends `server/tsconfig.json`, enables `noEmit`, disables incremental output, and includes
  only `packages/tags/src/models/tagMapping.ts`, `server/src/lib/api/controllers/ApiTagController.ts`,
  and `server/src/lib/api/services/TagService.ts` (imports are type-checked transitively).
- No app server or live HTTP check was run.

## Customer-specific unresolved evidence

The historical hosted Loki window is retained and includes YourColo's hosted ticket-notification
stream, but does not expose the failed REST request or a related tag-table error. The selected
namespace/container does not prove coverage of an appliance installation. The customer root cause
therefore remains unresolved and no schema migration or customer-specific repair is claimed. The
`stack-up` failure (`exit 7: no output`) also remains undiagnosed because no originating command
output or matching stack-up log was available. Review first when supplied: request timestamp and
trace ID, deployment identity (hosted pod vs appliance), full 42703 SQL error, and the affected
database's tag schema plus applied migration history.

## Takeover evidence and access dependency

- Read the support notifications in Gmail thread `1a1318023ec21d21`, including the original
  report, retest, and subsequent support replies. They describe the tag API failure but provide
  no failed tag-call timestamp, trace/request identifier, or PostgreSQL error. The original
  report's SLA ticket timestamps are not timestamps for the failed tag request.
- Searched Loki for `(?i)tag_mappings|tag_definitions` over October 12–13 UTC in
  `{namespace="stackgres-pgvector"}` and `{namespace="msp"}`. Both returned zero entries.
  A separate October 22 UTC search with the same expression over
  `{namespace=~"stackgres-pgvector|postgres|stackgres"}` also returned zero entries.
  Unfiltered positive-control queries returned database infrastructure logs from both
  `stackgres-pgvector` and `postgres` on October 22. These controls establish retained logs,
  not that either database served the customer's failed call.
- Broader October 1–23 searches for the tag tables and the report's SLA ticket IDs timed out.
  Those searches establish no presence or absence of the customer error.
- The access dependency is the affected deployment's failed-request application/PostgreSQL
  diagnostics, deployment/image identity, and tag-table schema plus applied migration ledger
  at the time of failure. Neither the support notifications nor the successful current-schema
  REST tests supply those artifacts. Obtain them from the operator with access to that
  deployment before choosing a column or migration to repair.
- Independently reran the three focused test files against disposable database
  `tag_entity_takeover_test`: 13 tests passed. The existing scoped TypeScript configuration
  also passed. No production code changed, no new build was run, and the original defect
  remains unresolved. The app server was not started.
