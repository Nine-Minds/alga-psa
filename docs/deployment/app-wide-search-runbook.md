# App-Wide Search Deploy Runbook

Use this runbook when deploying the app-wide search index for the first time in an environment.

## Steps

1. Apply the database migration that creates `app_search_index` and its indexes.

   ```bash
   npm run migrate
   ```

2. Deploy the application with live indexing disabled.

   ```bash
   SEARCH_INDEX_LIVE=false
   ```

   For Helm deployments, keep `server.searchIndexLive: false`.

3. Backfill the index.

   ```bash
   npm run search:backfill
   ```

   To backfill one tenant first:

   ```bash
   npm run search:backfill -- --tenant=<tenant_uuid>
   ```

4. Flip live indexing on and roll the server/workers.

   ```bash
   SEARCH_INDEX_LIVE=true
   ```

   For Helm deployments, set `server.searchIndexLive: true`.

5. Verify search health for a sampled tenant.

   ```sql
   SELECT object_type, count(*), max(indexed_at)
   FROM app_search_index
   WHERE tenant = '<tenant_uuid>'
   GROUP BY object_type
   ORDER BY object_type;
   ```

6. Confirm the daily `search:reconcile` job is registered. It repairs missed events by re-indexing updated or missing source rows and deleting orphaned index rows.


## Smart search (enterprise) reads the index

Smart search on the Tickets and Projects pages builds each row's text for the
Jev model partly from `app_search_index`: ticket comment bodies come from
`ticket_comment` rows (with their `metadata.author_kind`) and project task
comments from `project_task_comment` rows, both filtered by the same ACL
predicate keyword search uses. Titles, descriptions, facts, and project tasks
are read from the source tables directly. A tenant whose index has not been
backfilled scores without comments until `search:backfill` runs. Ticket comment
rows indexed before `author_kind` existed are treated as technician comments
until the daily reconcile or a backfill rewrites them.
