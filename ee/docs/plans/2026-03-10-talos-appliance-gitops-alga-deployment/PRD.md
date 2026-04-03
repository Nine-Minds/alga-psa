# PRD — Talos appliance GitOps Alga deployment

- Slug: `talos-appliance-gitops-alga-deployment`
- Date: `2026-03-10`
- Status: Draft

## Summary

Build a Talos appliance deployment path for Alga PSA that uses Flux-managed GitOps to reconcile the on-prem runtime stack. The stack must bring up the Alga server, Postgres, PgBouncer, Redis, Hocuspocus, email-service, workflow-worker, Temporal, and temporal-worker using repository-local Helm assets where possible. Initial startup must run database bootstrap and one-time seeds. Later restarts must reuse existing volumes and must not perform a fresh setup.

## Problem

The current repository has the core pieces needed to run Alga PSA on Kubernetes, but the appliance-oriented Talos delivery path is incomplete on this branch. The root chart does not yet express the full on-prem stack the appliance needs, PgBouncer only has Docker assets, and the current Helm bootstrap behavior is split across migration and seed hooks that do not cleanly model first-run versus restart behavior for a GitOps-managed appliance.

## Goals

1. Deploy Alga PSA on the Talos appliance through Flux-managed GitOps rather than direct first-boot Helm commands.
2. Bring up the equivalent of the cloud build runtime set: server, Postgres, PgBouncer, email-service, workflow-worker, Temporal, and temporal-worker.
3. Reuse the existing root `helm/` chart for core Alga deployment and reuse existing EE worker charts.
4. Ensure initial startup performs idempotent database bootstrap and one-time seeding.
5. Ensure later restarts and Flux reconciliations reuse existing persisted state and do not reseed.

## Non-goals

1. Building a complete OVA/QCOW2 Talos image pipeline in this change.
2. Implementing multi-node HA behavior for the appliance profile.
3. Solving private registry credential distribution in every environment.
4. Replacing existing hosted/cloud deployment flows.

## Users and Primary Flows

1. Deployment engineer boots the Talos appliance, confirms Flux is present, and applies the Talos single-node application profile.
2. Flux reconciles the Alga stack from this repository and waits for the bootstrap hook plus workloads to become Ready.
3. Operator reboots the appliance or lets Flux reconcile a later change and expects existing PVC-backed state to be reused without a second seed pass.

## UX / UI Notes

There is no end-user UI change in scope. Operator-facing behavior should be communicated through docs and logs:

- bootstrap hook logs should clearly distinguish "running seeds" from "seeds already present, skipping"
- appliance scripts should point to the Talos single-node GitOps profile explicitly
- runtime namespaces and Helm release names should be predictable for support/debugging

## Requirements

### Functional Requirements

1. Add an appliance-owned Flux profile for a Talos single-node deployment.
2. Render the root `helm/` chart as the `alga-core` release for on-prem runtime ownership.
3. Add a Kubernetes-managed PgBouncer release path.
4. Reconcile `workflow-worker`, `email-service`, and `temporal-worker` as separate Helm releases.
5. Reconcile a Temporal server release suitable for the appliance profile.
6. Replace the current split migration/seed behavior with one idempotent bootstrap job that can safely rerun on upgrade.
7. Detect existing seeded state from the database and skip seeds when state already exists.
8. Preserve generated DB credentials across reconciliations so persisted volumes remain usable.
9. Route the main application and workers through PgBouncer while bootstrap still talks directly to Postgres.
10. Provide appliance bootstrap/deploy scripts that point at the Flux profile.

### Non-functional Requirements

1. Use PVC-backed persistence for Postgres, Redis, and local file storage.
2. Keep the deployment path GitOps-friendly and stable across no-op reconciliations.
3. Keep the appliance profile single-node compatible with one replica defaults where appropriate.
4. Minimize drift from existing Compose and Helm bootstrap behavior.

## Data / API / Integrations

- Database bootstrap uses `server/setup/create_database.js` plus `setup/entrypoint.sh`.
- The root chart already owns Postgres, Redis, Hocuspocus, and server deployment logic.
- `ee/helm/workflow-worker`, `ee/helm/email-service`, and `ee/helm/temporal-worker` provide separate Kubernetes deployment surfaces for the EE services.
- Temporal server is expected to be deployed through a HelmRepository-backed release in the appliance profile.

## Security / Permissions

- Generated DB and Redis credentials must remain stable across reinstalls against existing PVCs.
- Bootstrap jobs and service deployments must use Kubernetes secrets rather than inline passwords.
- The Talos appliance path should not bake secrets into the repository.

## Observability

Out of scope for dedicated new observability features, but the deployment must preserve useful operator signals:

- Helm hook/job logs for bootstrap status
- predictable release names and namespaces
- readiness/liveness behavior from the existing charts

## Rollout / Migration

1. First target is a Talos single-node appliance profile.
2. Existing hosted and non-appliance flows must continue to work unchanged.
3. Future HA profiles can build on the same Flux layout with additional values overlays.

## Open Questions

1. Which image registry and credential delivery model should the appliance use by default for EE images?
2. Should Temporal remain a separate release backed by the official chart, or should the repo eventually vendor that chart for air-gapped deployments?

## Acceptance Criteria (Definition of Done)

1. The repository contains an appliance Flux profile for Talos single-node deployment.
2. The repository contains a Kubernetes deployment path for PgBouncer.
3. The root chart uses one idempotent bootstrap job for database creation, migrations, and seed gating.
4. Root-chart DB credentials are preserved across reconciliations against existing PVCs.
5. Appliance values overlays render the full on-prem runtime stack and point app/worker services at PgBouncer.
6. Helm rendering succeeds for the appliance profile and the new/updated charts.
