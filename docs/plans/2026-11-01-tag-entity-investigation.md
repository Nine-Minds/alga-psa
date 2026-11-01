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

- The focused command above passed: 3 test files, 13 tests.
- `npx eslint packages/tags/src/models/tagMapping.ts server/src/lib/api/controllers/ApiTagController.ts server/src/lib/api/services/TagService.ts server/src/test/integration/api/tagEntityRoute.integration.test.ts server/src/test/integration/api/helpers/withRolledBackSchemaContract.ts server/src/test/unit/api/apiMiddleware.productAccess.test.ts` completed with 0 errors and 88 warnings. The warnings are unused imports/parameters, `any`, and non-null assertions in the existing controller/service files; the added helper/model/test lines emitted no warning.
- `npm run typecheck` from `server/` was attempted and failed when Node reached its 4 GB heap limit (`FATAL ERROR: Reached heap limit`).
- `NEXT_TELEMETRY_DISABLED=1 npm run build:source` compiled successfully and generated all 74 static pages. Next reported that it skipped type validation; the explicit typecheck above remains the type-validation result.
- No app server or live HTTP check was run.
