# Appliance Architecture & Codebase Map

> **Scope.** A 10,000-foot overview of the on-prem **appliance** — what the
> components are, how they fit together, how an install actually happens, and
> **where in the codebase to look** for each piece. This is an index, not a
> tutorial: each section points at the real files that hold the details.
>
> This describes the current **Ubuntu + k3s + Kubernetes-hosted control plane +
> registry-metadata** implementation. The older Talos-based design narrative in
> [`README.md`](./README.md) and [`k8s-on-prem-deployment-plan.md`](./k8s-on-prem-deployment-plan.md)
> is historical. The design rationale for the registry-metadata release model is
> in [`ee/appliance/docs/registry-metadata-design.md`](../../appliance/docs/registry-metadata-design.md).

All paths are relative to the repo root. Everything for the appliance lives
under [`ee/appliance/`](../../appliance/); its own
[`README.md`](../../appliance/README.md) is the package-level companion to this
doc.

---

## 1. The big picture

The appliance is a **single-node, self-contained on-prem deployment** of Alga
PSA. It ships as an Ubuntu ISO that boots into k3s and runs its *entire* control
plane as Kubernetes workloads. The only host-level responsibility is a thin
systemd bootstrap that starts k3s and hands off to an in-cluster setup UI.

```
 Ubuntu ISO (autoinstall)
   └─ systemd: alga-appliance-bootstrap.service
        ├─ starts k3s (the substrate)
        ├─ imports the baked control-plane image
        └─ applies the control-plane Deployment, then prints the setup banner
              │
              ▼
 Kubernetes-hosted control plane  (ns: alga-appliance-control-plane)
   Deployment appliance-control-plane  →  host-service/server.mjs on :8080
        ├─ serves the setup wizard + status UI
        ├─ runs the setup workflow (setup-engine.mjs)
        └─ writes Flux resources that install the app
              │
              ▼
 Flux (GitOps) reconciles from the OCI registry (ghcr.io/nine-minds)
   OCIRepository (config bundle) + HelmRepository (charts)
        └─ Kustomizations: alga-platform → alga-core → alga-background
              │
              ▼
 PSA application stack (Helm releases)
   ns msp         : alga-core (sebastian), db, redis
   ns alga-system : pgbouncer, temporal, temporal-worker, workflow-worker, email-service
```

**Four namespaces** carry the whole system:

| Namespace | Holds |
|---|---|
| `alga-appliance-control-plane` | the setup/status control-plane pod |
| `flux-system` | Flux controllers + the child Kustomizations + the OCI/Helm sources |
| `alga-system` | platform HelmReleases (pgbouncer, temporal, workers, email) |
| `msp` | the PSA app (alga-core / sebastian), database, redis, initial tenant |

---

## 2. Components & where they live

### Host bootstrap (systemd)
The host does as little as possible. See
[`ee/appliance/systemd/`](../../appliance/systemd/):

- **`alga-appliance-bootstrap.service`** — oneshot. `ExecStartPre` runs
  `init-token.mjs` + `init-admin-credential.mjs`; `ExecStart` runs
  `scripts/bootstrap-control-plane.sh`; `ExecStartPost` runs
  `console.mjs --emit-runtime-banner` (prints the setup URL + token on tty1).
- **`alga-host-agent.service`** — long-running. Runs `host-service/host-agent.mjs`,
  a diagnostics Unix socket the in-pod control plane calls for host journals.
- **`alga-appliance.sysusers`** — reserves the `alga` group (GID 10001) used for
  the host-agent socket.

> Note: `scripts/bootstrap-appliance.sh` / `bootstrap-site.sh` and
> `schematics/` are the **legacy Talos** path, not used by the Ubuntu ISO.

### The Kubernetes-hosted control plane
The setup/status brain. See [`ee/appliance/control-plane/`](../../appliance/control-plane/)
and [`ee/appliance/host-service/`](../../appliance/host-service/):

- **`control-plane/Dockerfile`** — multi-stage: builds the Next.js status UI from
  `status-ui/`, then a runtime image with `bash/curl/kubectl/flux` that bundles the
  `host-service/*.mjs`, `manifests/`, and `flux/` trees. Runs as UID 10001.
  *(It intentionally does **not** bake `releases/` — release metadata is resolved
  from the registry at setup time.)*
- **`control-plane/manifests/`** — `namespace.yaml`, `rbac.yaml`,
  `workload.yaml` (the `appliance-control-plane` Deployment: 1 replica,
  `hostNetwork`, hostPort 8080, mounts the host state dir + setup-token secret),
  and `kustomization.yaml`.
- **`scripts/control-plane-entrypoint.sh`** — the pod's entrypoint: builds an
  in-cluster kubeconfig from the service-account token, then runs `server.mjs`.

### host-service — the runtime (`ee/appliance/host-service/`)
Plain Node ESM (`.mjs`), no build step. The pieces:

| File | Role |
|---|---|
| `server.mjs` | HTTP server on :8080. Routes: `/healthz`, `/setup` (UI), `/api/setup/config`, `/api/setup` (POST), `/api/status`. Serves the static status UI, validates input, and dispatches the setup workflow. |
| `setup-engine.mjs` | The setup workflow (see §3). Resolves the release from the registry, renders runtime values, writes the initial-tenant Secret + release-selection ConfigMap, and applies the Flux source. |
| `update-engine.mjs` | Channel **upgrades**: re-resolve the channel, update release selection, `flux reconcile`. |
| `status-engine.mjs` | Cluster health: HelmReleases, pods, readiness tiers (platform / core / bootstrap / login). Backs `/api/status`. |
| `console.mjs` | Console (tty1) setup banner + fallback flow; writes `/etc/issue` and `/etc/motd`. |
| `host-agent.mjs` | The diagnostics socket daemon (host side of `alga-host-agent.service`). |
| `kubectl-queue.mjs` | Serializes kubectl calls (one at a time, with timeout/output caps). |
| `metadata-engine.mjs` | Persists maintenance metadata (OS info, bootstrap/upgrade history). |
| `init-token.mjs` / `init-admin-credential.mjs` | Generate the setup token and the temporary console admin password on first boot. |
| `resolve-control-plane-image.mjs` | Prints the channel-pinned control-plane image ref from the release manifest (used by `bootstrap-control-plane.sh` to roll the control plane from the registry). |
| `bootstrap-boundary.mjs` | Phase constants for the host bootstrap. |
| `support-bundle.mjs` | Builds a redacted diagnostics tarball. |
| `tests/` | Node test runner specs for the engines (workflow, update, status, control-plane packaging, first-boot smoke, etc.). |

### The setup UI (`ee/appliance/status-ui/`)
A small Next.js app. `app/setup/page.tsx` is the wizard (channel, app hostname,
DNS, tenant + admin); `app/page.tsx` is the status view. It's built into static
`dist/` and served by the control-plane pod (the Dockerfile copies it to
`ALGA_APPLIANCE_STATUS_UI_DIR`).

### Flux / Helm layer (`ee/appliance/flux/`)
GitOps definitions, published to the registry as the **config bundle**:

- `flux/base/kustomization.yaml` — top of the bundle: namespaces + the charts
  HelmRepository + the child Kustomizations.
- `flux/base/charts/helm-repository.yaml` — `HelmRepository` `alga-charts`
  (`type: oci`, `oci://ghcr.io/nine-minds/charts`).
- `flux/base/flux/kustomizations.yaml` — the dependency chain
  **`alga-platform` → `alga-core` → `alga-background`**, all sourced from the
  `OCIRepository alga-appliance` that the setup workflow creates.
- `flux/base/releases/*.yaml` — one HelmRelease each: `alga-core` (chart
  `sebastian`, ns `msp`), `pgbouncer`, `temporal`, `temporal-worker`,
  `workflow-worker`, `email-service` (ns `alga-system`). Each pulls values from a
  generated ConfigMap.
- `flux/base/platform/appliance-status.yaml` — in-cluster RBAC + status helpers
  the control plane queries (uses the Flux **v1** APIs).
- `flux/profiles/single-node/values/*.single-node.yaml` — the per-service value
  overrides baked into the release manifest's `profileValues`.

> **Flux apiVersions:** the appliance's Flux serves source CRDs
> (OCIRepository/HelmRepository/GitRepository) + Kustomization at **`v1`** and
> HelmRelease at **`v2`**. Don't reintroduce `v1beta2`.

### Release metadata (`ee/appliance/releases/`)
- `schema.json` — JSON Schema for `release.json`.
- `releases/<version>/release.json` — the app image tags (`algaCore`,
  `workflowWorker`, `emailService`, `temporalWorker`), the values profile, and
  the release branch. **This is what you edit to pin a new app image.**
- `channels/` — `stable.json` / `nightly.json` historical pointers.

### Publish & build tooling (`ee/appliance/scripts/`)
- `publish-appliance-release.sh` — packages + pushes everything to
  `ghcr.io/nine-minds`: the 6 Helm charts, the Flux **config bundle** (`flux push
  artifact`, digest captured), the **control-plane image**, and the **release
  manifest** (`oras`, tagged `:<version>` + `:<channel>`).
- `build-release-manifest.py` — assembles the release-manifest JSON (images +
  chart versions + config-bundle digest + control-plane ref + profile values)
  that `publish-appliance-release.sh` pushes.
- `bootstrap-control-plane.sh` — the host bootstrap: start k3s, import the baked
  image, resolve + pull the channel control-plane image, apply the Deployment,
  report handoff.
- `stage-control-plane-bundle.sh` — builds + stages the baked control-plane image
  archive into the ISO overlay.
- `install-storage.sh` / `manifests/local-path-storage.yaml` — local-path
  provisioner.
- `bin/alga-control-plane-reapply` — non-destructive recovery: re-import +
  re-apply the control plane.

### ISO builder (`ee/appliance/ubuntu-iso/`)
- `config/nocloud/user-data` — the autoinstall seed. Identity `alga-admin`,
  `interactive-sections: [network, storage]` (the installer pauses on those two),
  late-commands copy the overlay into `/target` and enable the systemd units, then
  reboot.
- `overlay/` — the host filesystem injected into the install: everything lands at
  `/opt/alga-appliance/` (scripts, host-service, flux, manifests, releases),
  plus the systemd units and `/etc/alga-appliance/`.
- `scripts/build-ubuntu-appliance-iso.sh` — entrypoint (`--base-iso`,
  `--release-version`). Calls `stage-host-artifacts.sh` (which builds the
  control-plane image + stages the overlay), then remasters with `xorriso`.
- `output/` — the built `alga-appliance-ubuntu-<version>.iso` + `.sha256`.

### Operator CLI (`ee/appliance/operator/`)
`ee/appliance/appliance` → `operator/lib/cli.mjs`: a TUI/CLI
(`tui`/`bootstrap`/`upgrade`/`reset`/`status`/`support-bundle`) that shells out to
the scripts above. Useful on a running box for status and lifecycle actions.

---

## 3. How an install happens (end to end)

1. **Boot.** The ISO autoinstalls Ubuntu (operator confirms the network + storage
   screens), copies the overlay, enables the systemd units, and reboots.
   → `ubuntu-iso/config/nocloud/user-data`
2. **Host bootstrap.** `alga-appliance-bootstrap.service` generates the setup
   token + temp admin password, runs `bootstrap-control-plane.sh` (k3s up, import
   baked image, **resolve the channel control-plane image from the registry and
   roll to it**, apply the Deployment), then prints the setup URL + token on the
   console. → `systemd/`, `scripts/bootstrap-control-plane.sh`,
   `host-service/resolve-control-plane-image.mjs`
3. **Operator opens the setup wizard** at `http://<ip>:8080/setup?token=…` and
   submits channel (`stable`), app hostname, DNS, tenant + admin.
   → `status-ui/app/setup/page.tsx`, `host-service/server.mjs`
4. **Setup workflow** (`setup-engine.mjs`, orchestrated by `runSetupWorkflow`):
   - `validateSetupInputs` → `runSetupPreflight` / `runNetworkChecks`
   - `resolveChannelMetadata` → `resolveReleaseManifest` resolves the channel tag
     on `ghcr.io/nine-minds/alga-appliance-release` to an immutable manifest
     (image tags + chart versions + config-bundle digest + control-plane ref +
     profile values), validated by `validateReleaseManifest`.
   - `applyReleaseSelectionConfiguration` + `applyRuntimeValuesAndReleaseSelection`
     write the per-service values ConfigMaps, the `appliance-release-selection`
     ConfigMap, and the **initial-tenant Secret** (tenant + admin, PBKDF2-hashed).
   - `applyFluxSource` creates the `OCIRepository` (config bundle, **pinned by
     digest**) + the parent Kustomization.
5. **Flux reconciles.** `alga-platform → alga-core → alga-background` apply the
   HelmReleases; charts come from the OCI `HelmRepository`. The app comes up in
   `msp` + `alga-system`. → `flux/base/`
6. **Tenant bootstrap.** The app's bootstrap job runs `create-tenant.ts` against
   the initial-tenant Secret, creating the tenant + admin and seeding
   roles/permissions/statuses. Login then works. → `helm/templates/appliance-bootstrap-configmap.yaml`,
   `server/scripts/create-tenant.ts`
7. **Status** is reported throughout by `status-engine.mjs` via `/api/status`
   (readiness tiers: platform / core / bootstrap / login).

---

## 4. The registry-metadata model (why no git, no ISO re-burn)

A **channel** (`stable`) is an OCI tag on a release manifest; everything it
references is pinned by digest/version, so a resolved release is immutable. The
appliance pulls all of it anonymously from `ghcr.io/nine-minds` (public read).

**Published artifacts** (all under `ghcr.io/nine-minds`):

| Artifact | What |
|---|---|
| `charts/<name>:<ver>` | the 6 Helm charts (OCI) |
| `alga-appliance-config:<ver>` | the Flux config bundle (the rendered `flux/base` tree) |
| `alga-appliance-control-plane:<ver>` | the control-plane image |
| `alga-appliance-release:<ver>` + `:<channel>` | the release manifest (its JSON is the artifact's config blob) |

**Consequences for what needs rebuilding:**

- **App image change** (e.g. a fix in `server/`) → build `alga-psa-ee`, pin the new
  tag in `releases/<ver>/release.json`, re-run `publish-appliance-release.sh`. **No
  ISO, no control-plane rebuild.**
- **Control-plane / setup-UI / engine change** → rebuild + publish the
  control-plane image; the next boot rolls to it from the registry. **No ISO.**
- **ISO re-burn only** for: k3s / base OS / Flux controllers / systemd units / the
  autoinstall seed / the baked baseline control-plane image.

See [`ee/appliance/docs/registry-metadata-design.md`](../../appliance/docs/registry-metadata-design.md)
for the full contract (publish side, consume side, decisions).

---

## 5. Quick file index

| I need to… | Look at |
|---|---|
| Understand the package | `ee/appliance/README.md` |
| See the boot path | `ee/appliance/systemd/`, `scripts/bootstrap-control-plane.sh` |
| Change the setup wizard | `ee/appliance/status-ui/app/setup/page.tsx` |
| Change the setup API / flow | `ee/appliance/host-service/server.mjs`, `setup-engine.mjs` |
| Change what the app stack is / Helm values | `ee/appliance/flux/base/`, `flux/profiles/single-node/values/` |
| Pin a new app image | `ee/appliance/releases/<ver>/release.json` |
| Publish a release to ghcr | `ee/appliance/scripts/publish-appliance-release.sh` |
| Rebuild the control-plane image | `ee/appliance/control-plane/Dockerfile` |
| Build the ISO | `ee/appliance/ubuntu-iso/scripts/build-ubuntu-appliance-iso.sh` |
| Diagnose a running box | `ee/appliance/host-service/status-engine.mjs`, `operator/`, `bin/alga-control-plane-reapply` |
| Understand the release model | `ee/appliance/docs/registry-metadata-design.md` |
