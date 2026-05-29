# Appliance registry-metadata design

## Goal

Remove git/branch coupling from the appliance install path. A booted appliance
must resolve a **channel** (`stable`/`nightly`) to an **immutable set of
registry artifacts** and install from them. No `repoBranch`, no
`raw.githubusercontent`, no git clone at install time.

This replaces the prior design where `setup-engine` read `release.json` /
`channels/*.json` / profile values from git and `applyFluxSource` created a
Flux `GitRepository` (which also served the helm charts via `chart: ./helm`).

## Artifacts (all in ghcr, published by the Argo pipeline)

All under `ghcr.io/nine-minds`. App images already exist; the rest are new.

1. **App images** (unchanged): `ghcr.io/nine-minds/alga-psa-ee:<short-sha>` (+ workflow-worker, email-service, temporal-worker tags as today).

2. **Helm charts as OCI** (new): `oci://ghcr.io/nine-minds/charts/<name>:<chartVersion>`
   for each chart used by the appliance: `sebastian` (alga-core + pgbouncer),
   `temporal`, `temporal-worker`, `workflow-worker`, `email-service`. Pushed via `helm push`.

3. **Flux base bundle as OCI** (new): `oci://ghcr.io/nine-minds/alga-appliance-config:<version>`
   — the rendered `ee/appliance/flux/` overlay (namespaces, child Kustomizations,
   HelmReleases, profile values), with each HelmRelease's chart source rewritten
   to the OCI chart ref + version. Pushed via `flux push artifact`. Pinned by **digest**.

4. **Control-plane image** (new — published, not just baked): `ghcr.io/nine-minds/alga-appliance-control-plane:<short-sha>`.
   Today it is only built locally and baked into the ISO (`localhost/...:baked`,
   `imagePullPolicy: IfNotPresent`, `k3s ctr images import`), so the setup UI /
   host-service can only be updated by re-burning an ISO. Publishing it to ghcr
   lets `bootstrap-control-plane.sh` **pull** it (channel/digest-pinned) and roll
   to it — making setup-UI / host-service updates registry-only.

5. **Release manifest as OCI** (new, the channel pointer): `oci://ghcr.io/nine-minds/alga-appliance-release`
   tagged `:stable`, `:nightly`, and `:<version>`. Its config blob is JSON:

   ```json
   {
     "schema": "alga.appliance.release/v1",
     "version": "1.0.3",
     "channel": "stable",
     "valuesProfile": "single-node",
     "images": { "algaCore": "62cdce38", "workflowWorker": "a2cbb43", "emailService": "61e4a00e", "temporalWorker": "a2cbb43" },
     "controlPlane": "62cdce38",
     "config": { "repository": "ghcr.io/nine-minds/alga-appliance-config", "version": "1.0.3", "digest": "sha256:..." },
     "charts": { "sebastian": "0.0.1", "temporal": "0.1.0", "temporal-worker": "0.1.0", "workflow-worker": "0.1.0", "email-service": "0.1.0" }
   }
   ```

   The manifest is the only mutable channel pointer; everything it references is
   pinned by digest/version, so a resolved release is immutable.

## Control-plane (setup UI / host-service) updates without an ISO burn

The setup UI already runs in k8s (the `appliance-control-plane` Deployment,
deployed by `bootstrap-control-plane.sh`), but its image is baked + imported, so
UI/engine changes still require an ISO. To finish that goal:

- Publish the control-plane image to ghcr (artifact #4) and add `controlPlane` to
  the release manifest.
- Keep a **baseline** control-plane image baked in the ISO so first boot can serve
  the UI with no network dependency.
- On boot, `bootstrap-control-plane.sh` resolves the channel's release manifest,
  and if `controlPlane` differs from the baked baseline, **pulls it from ghcr and
  rolls the Deployment to it**. Result: setup-UI / host-service updates become a
  channel repoint — no ISO. The ISO then only needs re-burning for k3s / base OS /
  Flux controllers / systemd units / the autoinstall seed.

## Consume side (`ee/appliance/host-service/setup-engine.mjs`)

- `resolveChannelMetadata`: HTTP to ghcr registry API — token (`GET /token?scope=repository:nine-minds/alga-appliance-release:pull`) → `GET /v2/.../manifests/<channel>` → fetch the config blob = the release manifest JSON. No git.
- `applyFluxSource`: create a Flux **OCIRepository** (`source.toolkit.fluxcd.io`) at `config.repository` pinned to `config.digest`, plus a Kustomization with `sourceRef: { kind: OCIRepository }`. No GitRepository.
- Image tags come from `manifest.images`, injected into the per-release values ConfigMap exactly as today.
- The flux-base HelmReleases (inside the config bundle) reference OCI charts pinned to `manifest.charts[name]`.
- `validateSetupInputs`: **drop `repoBranch`/`repoUrl`**. Keep `channel`. (Optional advanced override: pin to a specific `version`/digest.)

## Publish side (Argo, `~/nm-kube-config/alga-psa/workflows`)

Add a publish stage (gated on a release/promote run; auth via the existing
`github-token` secret, user `robertisaacs`):

1. `helm package` + `helm push oci://ghcr.io/nine-minds/charts/<name>` for each chart.
2. Render `ee/appliance/flux/` with chart sources rewritten to OCI refs+versions; `flux push artifact oci://ghcr.io/nine-minds/alga-appliance-config:<version>` (capture digest).
3. Build the release manifest JSON (images from the build, config digest from step 2, chart versions from step 1) and `oras push oci://ghcr.io/nine-minds/alga-appliance-release:<channel>` (and `:<version>`).

## Decisions (made, with rationale)

- **Full OCI** (charts + flux base + manifest all in the registry) rather than a
  host-templated base — it keeps base/structure changes out of the control-plane
  image (a new bundle artifact, not a rebuild) and is Flux-native.
- **Channel = OCI tag** on the release manifest; everything else pinned by
  digest/version for immutability.
- **ghcr only** for now (the appliance already requires ghcr egress; the preflight
  already checks `ghcr.io/v2/`). Harbor mirror optional later.
- Public read on these metadata/chart artifacts (no pull secret needed), matching
  how images are pulled today.

## Bootstrapping / rollout

- Publishing requires the Argo additions to run. To validate the consume side
  before wiring CI, the artifacts can be published once manually from a
  workstation (`helm push`, `flux push artifact`, `oras push` with a `gh` token).
- This engine change ships in the control-plane image, so **one** more
  control-plane image build + ISO is needed; after that, channel/tag/release
  changes are registry-only (publish artifacts → appliance picks them up; no
  control-plane rebuild, no ISO, no branch).
