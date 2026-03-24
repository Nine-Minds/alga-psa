# Talos GitOps Bootstrap

## Purpose

The appliance install path is designed so Talos owns cluster bring-up and Flux owns application reconciliation. That separation is intentional:

- Talos is responsible for the Kubernetes host and API.
- Flux is responsible for the Alga runtime stack.

## Namespace Model

The current appliance model uses three main namespaces:

- `flux-system`: Flux controllers and Git source objects
- `alga-system`: appliance-owned GitOps coordination objects
- `msp`: application workloads

This should remain the default layout unless there is a strong need to change the release boundaries.

## Flux Profile Layout

The repo-owned GitOps input lives under:

- `ee/appliance/flux/base/`
- `ee/appliance/flux/profiles/talos-single-node/`

The base layer defines the `HelmRelease` objects. The profile layer supplies environment-specific values through `ConfigMap` generators.

This is important for two reasons:

1. The release topology stays stable even when image tags or replica counts change.
2. The appliance profile can inject values without requiring direct edits to the chart defaults.

## Release Boundaries

The single-node profile currently models separate `HelmRelease`s for:

- `alga-core`
- `pgbouncer`
- `temporal`
- `workflow-worker`
- `email-service`
- `temporal-worker`

The separation is deliberate. It keeps the core app, connection pooler, workers, and workflow runtime independently reconcilable.

## Deployment Ordering

The intended dependency flow is:

1. Flux becomes healthy.
2. Namespace and values config are present.
3. `alga-core` reconciles.
4. `pgbouncer` and other dependent services reconcile.
5. worker releases settle after their dependencies exist.

Where explicit `dependsOn` relationships exist in the `HelmRelease` definitions, they should be treated as part of the install contract, not an implementation detail.

## Bootstrap Script Contract

`ee/appliance/scripts/bootstrap-appliance.sh` is the operator-facing entrypoint for first boot and ordinary redeploys.

Its intended responsibilities are:

- resolve a release manifest and its paired Talos installer image
- persist generated `talosconfig`, `kubeconfig`, rendered machine config, and rendered values in an operator-owned directory
- generate and apply Talos machine config when the cluster does not exist yet
- install the single-node storage prerequisite before application reconciliation
- install Flux when it is not already present
- create or reuse `msp/alga-psa-shared`
- resolve the selected appliance release manifest, including its app release branch and pinned component tags
- render runtime values into cluster-managed `ConfigMap`s
- record the selected appliance release in a cluster-side release selection object
- create the Flux Git source and `Kustomization` for `ee/appliance/flux/base`
- wait for the first-run `alga-core` bootstrap sequence to complete

`ee/appliance/scripts/bootstrap-site.sh` is retained as a thin compatibility wrapper that forwards to `bootstrap-appliance.sh`.

## Runtime Values Injection

The durable GitOps topology lives in `ee/appliance/flux/base/`. Runtime values such as the selected appliance release and its pinned component tags are injected separately as cluster `ConfigMap`s rather than being committed back into the repo.

That split is intentional:

1. the release topology remains GitOps-managed
2. per-site release selection stays explicit and operator-chosen
3. the appliance bootstrap path does not need to rewrite committed profile files

The profile values under `ee/appliance/flux/profiles/talos-single-node/values/` remain the source templates for those generated runtime `ConfigMap`s.

## Explicit Image Tags

The appliance bootstrap path should not default application images to `latest`.

Each published appliance release should pin tags for:

- `alga-core`
- `workflow-worker`
- `email-service`
- `temporal-worker`

This rule exists to keep appliance deployments deterministic and auditable. A fresh install or upgrade should not silently drift because a registry moved `latest`.

## Secrets Model

The bootstrap script currently manages one shared application secret directly:

- `msp/alga-psa-shared` containing `ALGA_AUTH_KEY`

Other secrets are expected to come from chart-managed resources or other deployment inputs. Repository-owned profiles must not bake live secret values into versioned files.

## Storage Prerequisite

The single-node appliance bootstrap must install and verify a usable storage class for PVC-backed services before Flux is expected to settle the app stack.

The current appliance path uses a repo-owned local-path style provisioner manifest and verifies it with a one-shot PVC smoke test.

Without that, GitOps will reconcile objects, but the application stack will remain blocked on unbound PVCs.

## Local Versus Generic Guidance

These docs define the GitOps model generically. A local `alga-talos` skill can layer on top of them with:

- which branch to point Flux at
- which release or candidate channel is under test
- which appliance release manifest is selected for a particular checkpoint
- which temporary workdir holds the current `talosconfig` and `kubeconfig`
