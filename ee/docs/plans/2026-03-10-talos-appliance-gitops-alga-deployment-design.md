# Talos Appliance GitOps Alga Deployment Design

- Date: `2026-03-10`
- Status: Approved

## Summary

Deploy Alga PSA on the Talos appliance through Flux-managed GitOps instead of direct first-boot Helm commands. The appliance should reconcile a single-node on-prem stack that includes the Alga server, Postgres, PgBouncer, Redis, Hocuspocus, email-service, workflow-worker, Temporal, and temporal-worker. Initial startup must bootstrap the database and run seeds once. Later restarts or Flux reconciliations must reuse existing PVC-backed state and must not reseed the database.

## Architecture

Talos first boot owns cluster bootstrap and Flux bootstrap only. Application installation is owned by Flux from an appliance-specific path in this repository.

Namespaces:

- `flux-system`: Flux controllers and bootstrap objects.
- `alga-system`: appliance coordination objects when needed.
- `msp`: Alga PSA runtime workloads, keeping compatibility with the existing Helm defaults.

Release boundaries:

- `temporal`: Temporal server/frontend persistence stack.
- `alga-core`: root `helm/` chart, owning server, Postgres, Redis, Hocuspocus, and bootstrap/migration behavior.
- `pgbouncer`: new Kubernetes deployment path for PgBouncer.
- `workflow-worker`: existing `ee/helm/workflow-worker` chart.
- `email-service`: existing `ee/helm/email-service` chart.
- `temporal-worker`: existing `ee/helm/temporal-worker` chart.

Ordering:

1. Talos boots Kubernetes.
2. First-boot logic installs Flux and points it at the appliance profile.
3. Flux reconciles namespaces, repositories, and values ConfigMaps.
4. Flux reconciles `temporal` and `alga-core`.
5. Flux reconciles `pgbouncer`, `workflow-worker`, `email-service`, and `temporal-worker`.

## Bootstrap And Idempotency

Initial install must be treated as "database not initialized" rather than "Helm release install." The current Compose setup already follows that model through `setup/entrypoint.sh`.

Desired behavior:

1. Postgres PVC comes up.
2. A pre-install/pre-upgrade bootstrap job runs from the setup image.
3. The bootstrap job creates databases/users idempotently, runs migrations, checks whether seed data already exists, and only runs seeds when the database is still empty.
4. Application pods start only after the bootstrap job succeeds.

Implications:

- Migrations are safe to run on upgrades.
- Seeds are guarded by database state and do not rerun on ordinary restart or release reconciliation.
- Recreating a Helm release against an existing PVC-backed database is safe because the job rechecks DB state before seeding.

## Implementation Shape

Repository additions:

- `ee/appliance/flux/base/`
- `ee/appliance/flux/profiles/talos-single-node/`
- `ee/appliance/flux/profiles/talos-single-node/values/*.yaml`
- `ee/appliance/scripts/bootstrap-site.sh`
- `ee/appliance/scripts/deploy-app.sh`
- `ee/helm/pgbouncer/`

Key chart changes:

- Replace the current split migration/seed Helm hook behavior in the root chart with one idempotent bootstrap hook that reuses the setup image and setup script semantics.
- Preserve generated DB credentials across Helm reconciliations instead of rotating them on reinstall.
- Add root-chart support for routing the server through PgBouncer while bootstrap still targets direct Postgres.

## Validation

Required validation:

- `helm template` succeeds for `alga-core` with the Talos single-node overlay.
- `helm template` succeeds for `pgbouncer`, `workflow-worker`, `email-service`, and `temporal-worker`.
- Fresh install runs bootstrap once, seeds once, and all core workloads become Ready.
- Restart or no-op Flux reconciliation does not trigger reseeding and continues to use existing PVC-backed state.
