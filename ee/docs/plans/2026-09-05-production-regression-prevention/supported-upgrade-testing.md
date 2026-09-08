# Supported upgrade testing

The approved baseline is v1.5.0 at `f3579f3a317cf51df5f4489e5dcd8f649bb71289`. The runner extracts both baseline and candidate HEAD from Git, preserving release-relative assets and CE/EE migration overlay order. It uses the installed candidate Node dependencies; this is disclosed in evidence.

Run from the repository root using the existing PostgreSQL service:

```sh
UPGRADE_DATABASE_ISOLATED=true \
UPGRADE_DB_NAME=upgrade_unique_run_name \
node node_modules/tsx/dist/cli.mjs scripts/run-supported-upgrade.ts
```

Supply `DB_HOST`, `DB_PORT`, `DB_USER_ADMIN`, `DB_PASSWORD_ADMIN` and `UPGRADE_TEST_PASSWORD_HASH` through the environment. The hash must belong to a synthetic test account whose password will be used for browser sign-in. Do not put credentials in commands, logs or evidence files. No Docker build is needed.

The database name must start with `upgrade_`; creation fails if it already exists. The runner never resets or adopts a database. It retains the database for subsequent application/browser checks and diagnosis. Its temporary output directory contains source manifests, synthetic fixture identities and `evidence.json`. The output path is printed at completion, including on failure.

Execution creates the old schema, seeds two tenants with baseline roles and permissions plus ticket and billing source data, captures business values and migration history, applies candidate migrations, and compares the retained values and original ledger entries. New migrations append to that history. Candidate source revision and working-tree state are recorded; uncommitted migration edits are not included in the Git archive.

A schema-and-retention pass does not establish working ticket actions, Add Usage, invoice generation, application tenant isolation, Citus upgrades or native CI. Those checks remain separate requirements and must run against this upgraded database using the retained fixture identities. Do not reset it using a clean-install browser bootstrap.

Keep only one upgrade app process active while iterating. Stop the previous owned process before switching its database; retaining multiple Next.js processes also retains their database pools. In the first combined host run, obsolete diagnostic apps exhausted PostgreSQL connection slots. The session revocation check correctly failed closed, redirecting a ticket reload through sign-in to the dashboard. Do not work around this by bypassing authentication or relaxing the browser assertion.

Use `e2e-tests/playwright.upgrade.config.ts` for the three browser journeys and set `UPGRADE_FIXTURE_PATH` to the runner's `fixture.json`, with the normal isolated `E2E_DB_*` and real sign-in environment. Start the application against that same database. Invoice generation consumes the secondary tenant's billing sources; Add Usage uses the primary tenant. For a complete rerun, create a new fixture database instead of assuming consumed invoice sources are fresh.

For a strict execution artifact, run `node e2e-tests/run-upgrade.mjs` from a clean checkout. Set `UPGRADE_SCHEMA_EVIDENCE` to the schema runner's `evidence.json` and `UPGRADE_APPLICATION_REVISION` to the verified running image's source revision. That revision and the schema source must equal HEAD. The runner records raw collection, raw execution, schema evidence and the combined verdict under `test-results/supported-upgrade/`. It refuses filters and stale or mismatched inputs. Merely setting the application revision variable does not attest to an image; the CI caller must establish that identity from the image it starts.
