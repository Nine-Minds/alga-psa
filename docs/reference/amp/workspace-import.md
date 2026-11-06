# Export and import a workspace

A customer workspace administrator opens **Export workspace** in the co-managed workspace and downloads
`workspace-<package-id>.amp`. The download contains records, file contents and explicit exclusions.
Use the AMP CLI to validate and inspect it before transferring it to an installation operator:

```bash
node packages/migration-cli/bin/alga-migrate.mjs validate workspace.amp
node packages/migration-cli/bin/alga-migrate.mjs inspect workspace.amp
```

On the target installation, run from `server` with the installation database-owner configuration:

```bash
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/import-amp-workspace.ts \
  --package /absolute/workspace.amp \
  --tenant <fresh-UUID> --name 'Restored workspace' --email owner@example.com
```

Repeat the same command, package and UUID to resume after a failure. An existing tenant that belongs
to another package is rejected. The command reports the migration job ID; records and outcomes use
the standard AMP migration tables and identity ledger. Failed record applications can be reviewed in
`migration_record_outcomes`, scoped by the target tenant and job ID.

Review restored records and file associations before activating users. Imported users are inactive;
workflows are paused, appointments/calendar dispatch cancelled, and provider connections require new
authorization. Source sessions, credentials, co-managed relationships and provider bindings are excluded.
Workflow task responses/history are retained as audit evidence rather than executable task-inbox rows.
There is no automatic activation or subscription provisioning.

`FORCE_CAPABILITIES=co-managed:off` disables the customer export and installation workspace import.
The retired workspace archive format is rejected; there is no conversion or legacy restore command.

Workspace admission records machine-owned target provenance on the migration job. Editable import
configuration cannot claim the four safety policies or authorize a workspace package in an existing
tenant. The installation operator must use a database-owner connection; customer browser sessions
cannot create target tenants. The package hash and target UUID bind retries to the same workspace.

Inline file and document links are resolved through the new tenant's identity ledger after record
and attachment creation. Unavailable targets become explicit unavailable-content links. The original
package exclusions remain in the job's inspection report. Historical workflow responses can be
exported again without reviving an execution or a task-inbox assignment.

The replacement migration retires the old restore tables irreversibly. It does not read or convert
archives or restore receipts. Ordinary database migration history remains intact.

The existing general AMP export keeps its core-record coverage. Full workspace domains and file bytes
are exposed through the capability-gated customer-admin workspace export. Both produce AMP 2 packages
through the same writer and are consumed by the same import pipeline.

## Developer validation

The workspace suite requires a migrated, disposable database named `amp_*_test`. The setup below
applies the checkout's CE and EE migrations without seeds, so it creates schema and migration
metadata only. Pick a new database name and confirm it does not exist first: the test database helper
drops and recreates the exact `TEST_DB_NAME` it receives. Do not point it at a database containing
tenant data. The suite then creates synthetic tenants and uses a private in-memory object provider;
it never starts the application.

```bash
export AMP_TEST_DB=amp_workspace_validation_test
export DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres
export PGPASSWORD="$(cat secrets/postgres_password)"

# Empty output means this isolated target name is available.
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER_ADMIN" -d postgres -Atc \
  "select datname from pg_database where datname='$AMP_TEST_DB'"

# The EE files overlay same-named CE files before any migration is applied.
mkdir -p server/.ee-combined-migrations-amp
cp -a server/migrations/. server/.ee-combined-migrations-amp/
cp -a ee/server/migrations/. server/.ee-combined-migrations-amp/
(
  cd server
  TEST_DB_NAME="$AMP_TEST_DB" \
  TEST_MIGRATIONS_DIR="$PWD/.ee-combined-migrations-amp" \
  npx tsx -e "import { createTestDbConnection } from './test-utils/dbConfig.ts'; void (async () => { const db = await createTestDbConnection({ runSeeds: false }); await db.destroy(); })();"
)

# Schema-only bootstrap must not create any tenants.
test "$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER_ADMIN" -d "$AMP_TEST_DB" -Atc \
  "select count(*) from tenants")" = 0

(
  cd server
  AMP_WORKSPACE_TEST_DATABASE="$AMP_TEST_DB" \
  AMP_WORKSPACE_TEST_EXPORT_PACKAGE=/tmp/amp-workspace-cli.amp \
  npx vitest run --config vitest.amp-workspace.config.ts
)

node packages/migration-cli/bin/alga-migrate.mjs validate /tmp/amp-workspace-cli.amp
node packages/migration-cli/bin/alga-migrate.mjs inspect /tmp/amp-workspace-cli.amp
(
  cd server
  npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/import-amp-workspace.ts --help
)
```

For a standalone restore check after the workspace suite, choose another fresh tenant UUID and run
the documented importer with the same package. Query the newly created tenant's `documents` and
`external_files` rows, then read the corresponding storage objects and compare their hashes with the
known fixture payloads. CLI validation verifies the package attachment digests. Set
`STORAGE_LOCAL_BASE_PATH` to a temporary directory for this check. The
workspace integration test checks both record restore and byte equality via an isolated in-memory
provider; the CLI check exercises the installation entry point against persistent local storage.

Example standalone CLI/file-byte check (run only after confirming the target UUID is absent):

```bash
export AMP_TARGET_TENANT=8a8f60a6-e4c0-4650-9bb2-235b8c30e44f
export AMP_STORAGE=/tmp/amp-workspace-cli-storage
(
  cd server
  NODE_ENV=development DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER_ADMIN="$DB_USER_ADMIN" \
  DB_PASSWORD_ADMIN="$(cat ../secrets/postgres_password)" DB_NAME_SERVER="$AMP_TEST_DB" \
  STORAGE_DEFAULT_PROVIDER=local STORAGE_LOCAL_BASE_PATH="$AMP_STORAGE" \
  npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/import-amp-workspace.ts \
    --package /tmp/amp-workspace-cli.amp --tenant "$AMP_TARGET_TENANT" \
    --name 'AMP CLI verification' --email amp-cli@example.invalid
)

document_path=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER_ADMIN" -d "$AMP_TEST_DB" -Atc \
  "select f.storage_path from documents d join external_files f on f.tenant=d.tenant and f.file_id=d.file_id where d.tenant='$AMP_TARGET_TENANT' and d.document_name='Runbook'")
conversation_path=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER_ADMIN" -d "$AMP_TEST_DB" -Atc \
  "select f.storage_path from documents d join external_files f on f.tenant=d.tenant and f.file_id=d.file_id where d.tenant='$AMP_TARGET_TENANT' and d.document_name='conversation.txt'")
expected=$(printf 'workspace document bytes\0' | sha256sum | cut -d' ' -f1)
document_sha=$(sha256sum "$AMP_STORAGE/$document_path" | cut -d' ' -f1)
conversation_sha=$(sha256sum "$AMP_STORAGE/$conversation_path" | cut -d' ' -f1)
test "$document_sha" = "$expected"
test "$(printf 'conversation bytes' | sha256sum | cut -d' ' -f1)" = "$conversation_sha"
```

After validation, remove the disposable database and temporary migration directory:

```bash
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER_ADMIN" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE \"$AMP_TEST_DB\""
node -e "require('node:fs').rmSync('server/.ee-combined-migrations-amp', { recursive: true, force: true })"
```

The ordinary AMP pipeline suite recreates its own named test database. Run the Temporal case in a
separate process with real Redis enabled: its fixture starts a disposable Redis container. The
other cases use the standard never-connecting Redis stub. This avoids both the stub's missing
stream methods and the event-bus singleton retaining configuration from earlier tests.

```bash
TEST_DB_NAME=amp_pipeline_test npx vitest run --config vitest.amp-existing.config.ts \
  --testNamePattern='^(?!.*persists typed custom asset fields).*'
TEST_DB_NAME=amp_temporal_test REAL_REDIS=1 npx vitest run --config vitest.amp-existing.config.ts \
  --testNamePattern='persists typed custom asset fields'
```

These two pipeline databases are recreated by the runner. Use only new `amp_*_test` names that have
been confirmed absent from the PostgreSQL instance; never use a database with tenant data.

Fresh import targets use the native tenant dispatch suspension (`suspended_at`, reason
`amp_workspace_review`) from creation onward. Job dispatch and tenant maintenance exclude them;
storage recovery/retention remains enabled as housekeeping. Completion does not release this gate.
After reviewing records, users, workflows and new connections, an installation operator can release
this specific suspension through the existing `resumeTenant` mechanism. No import command activates
users or clears another suspension reason.
