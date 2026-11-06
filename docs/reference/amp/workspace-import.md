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

The workspace suite requires a migrated, disposable database named `amp_*_test`. It creates only
synthetic tenants and uses a private in-memory object provider; it never starts the application:

```bash
cd server
AMP_WORKSPACE_TEST_DATABASE=amp_workspace_test npx vitest run --config vitest.amp-workspace.config.ts
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

Fresh import targets use the native tenant dispatch suspension (`suspended_at`, reason
`amp_workspace_review`) from creation onward. Job dispatch and tenant maintenance exclude them;
storage recovery/retention remains enabled as housekeeping. Completion does not release this gate.
After reviewing records, users, workflows and new connections, an installation operator can release
this specific suspension through the existing `resumeTenant` mechanism. No import command activates
users or clears another suspension reason.
