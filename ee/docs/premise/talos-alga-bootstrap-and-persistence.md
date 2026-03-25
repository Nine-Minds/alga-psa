# Talos Alga Bootstrap And Persistence

## Purpose

The Alga appliance must behave correctly in both of these cases:

1. a genuinely fresh database
2. an existing PVC-backed database being brought back after restart or reconcile

The bootstrap design should model database state, not just Helm lifecycle.

## First-Run Definition

For the appliance, "first run" means the application database is not initialized yet. It does not simply mean "this is Helm install revision one."

That distinction matters because a Helm release can be recreated against an existing PVC-backed database. If bootstrap is keyed only to install events, reseeding and credential drift become likely.

## Bootstrap Job Contract

The root `helm/` chart owns the initial database bootstrap behavior for `alga-core`.

The bootstrap job is responsible for:

- waiting for direct PostgreSQL connectivity
- creating databases and roles idempotently
- creating required schemas such as `pgboss`
- running migrations
- checking whether seed data already exists
- running seeds only when the database is still empty

The seed gate is intentionally data-driven. The current pattern checks whether the `users` table already has rows and skips seeds if it does.

## Runtime Image Compatibility

The bootstrap job must be compatible with the actual image layout used by the appliance.

In this repository, the job uses the application image and invokes setup logic from the `/app` tree, including:

- `/app/server/setup/create_database.js`
- `knex` migrations and seeds from the server workspace

That behavior should remain aligned with the runtime image contract. The bootstrap path must not assume a different filesystem layout than the image actually ships.

## Direct Postgres Versus PgBouncer

The appliance may route normal application traffic through PgBouncer, but bootstrap and admin operations still need a direct Postgres path for operations that PgBouncer does not handle well.

The durable rule is:

- `alga-core` bootstrap and server startup should use direct Postgres in the appliance profile
- worker and auxiliary services may use PgBouncer after `alga-core` is healthy
- database creation, schema creation, and admin migration steps should talk directly to Postgres

This avoids a bootstrap cycle where the core application waits on a PgBouncer service that is itself modeled as a downstream dependency of the core release.

## App Startup Gate

Application pods should not race ahead of bootstrap. The current chart uses an init-container gate so the app waits until bootstrap has created the expected initial database state.

That prevents the server pod from coming up against an uninitialized database and turning a deterministic bootstrap task into noisy runtime failures.

## Credential Persistence

`db-credentials` is a persistent contract, not a disposable install artifact.

The chart currently preserves the secret with a keep policy and avoids recreating it blindly when a compatible existing secret already exists. That is necessary because ordinary reinstall behavior must not generate a new database superuser password against an existing Postgres volume.

The operational rule is simple:

- do not rotate database bootstrap credentials as a side effect of Helm reconciliation
- if a Postgres PVC already exists and `db-credentials` does not, fail before generating new credentials

## PVC-Backed State

The single-node appliance currently expects persistent volumes for:

- Postgres
- Redis
- server file storage
- optionally Temporal persistence

If those PVCs survive, a restart should return to service without reseeding. If they are deleted, the stack should be treated as a fresh environment again.

For the appliance profile, uninstall and remediation flows should preserve PVCs by default. Failed first-install attempts should not trigger destructive PVC cleanup hooks.

## Bootstrap Modes

The appliance bootstrap flow should expose two explicit operating modes:

- `fresh`: wipes persisted appliance data before reinstalling and expects the database to be empty
- `recover`: preserves existing appliance data and reuses the surviving credential/state contract

These modes are not just operator labels. They should drive bootstrap behavior:

- `fresh` should fail if existing application database state is detected after connectivity succeeds
- `recover` should tolerate existing databases and seeded rows, then let migrations and runtime checks converge safely

The bootstrap path should never silently create a new database secret against an existing Postgres volume.

## Fresh Install Expectations

A correct fresh install should look like this:

1. storage provisions PVCs
2. Postgres becomes reachable
3. bootstrap job creates databases and roles
4. migrations run
5. seeds run once
6. app pod clears its bootstrap gate
7. dependent workers reconcile afterward

If a supposed fresh install still finds existing databases or seeded rows, the appliance should fail clearly and tell the operator to wipe persisted data or rerun in recover mode.

## Restart Expectations

A correct restart or no-op reconcile should look like this:

1. existing PVCs reattach
2. bootstrap logic re-checks database state
3. migrations are safe to rerun if needed
4. seeds are skipped because the database is not empty
5. application and workers return without first-run behavior repeating

## Storage Class Assumption

The profile values currently target a local-path style storage class for the single-node appliance. That is a deployment assumption, not just a convenience setting.

If a different provisioner is used later, the same behavioral contract still applies:

- PVC-backed data is the persistence boundary
- bootstrap must be safe against existing data
- the app must not depend on Helm revision numbers to decide whether setup has happened
