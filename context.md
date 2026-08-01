# Code Context: Appliance Release/Registry Manifest Flow

## Files Retrieved

1. **`ee/appliance/releases/schema.json`** (lines 1-60) — Schema for `release.json` files, defines required fields including `app.images.algaCore`, `workflowWorker`, `emailService`, `temporalWorker`.

2. **`ee/appliance/releases/1.0/release.json`** (all) — Concrete release manifest for v1.0. The `app.images.algaCore` tag is `"eaec6253"`. This is the **source of image tags** consumed by the publish pipeline.

3. **`ee/appliance/releases/channels/stable.json`** (all) — Points channel `"stable"` to `releaseVersion: "1.0"`. Also carries the legacy `repoBranch` field (not used by the OCI path).

4. **`ee/appliance/scripts/build-release-manifest.py`** (all, 88 lines) — Builds the OCI release manifest JSON (`alga.appliance.release/v1`). Reads image tags from `ee/appliance/releases/<version>/release.json`, chart versions from each `Chart.yaml`, profile values from `ee/appliance/flux/profiles/<profile>/values/`, and writes the complete manifest to stdout.

5. **`ee/appliance/scripts/publish-appliance-release.sh`** (all, 121 lines) — The **publish script** that pushes all artifacts to GHCR:
   - Helm charts → `oci://ghcr.io/nine-minds/charts/<name>`
   - Flux config bundle → `oci://ghcr.io/nine-minds/alga-appliance-config:<version>`
   - Release manifest (via `oras push`) → `oci://ghcr.io/nine-minds/alga-appliance-release:<version>` + `:<channel>`
   - Control-plane image → `ghcr.io/nine-minds/alga-appliance-control-plane`

6. **`ee/appliance/scripts/build-images.sh`** (lines 115-150) — Generates `release.json` from build-time tag arguments (`--alga-core-tag`, etc.) using `render_manifest()`.

7. **`ee/appliance/host-service/setup-engine.mjs`** (key sections: 20-25, 240-400, 850-950, 974-1081, 1117-1200) — The **consume side**:
   - `resolveReleaseManifest()` — fetches the OCI release manifest from GHCR via HTTP registry API
   - `resolveChannelMetadata()` — resolves a channel to an immutable release manifest
   - `applyRuntimeValuesAndReleaseSelection()` — injects `images.algaCore` into profile values as `setup.image.tag` and `server.image.tag`
   - `applyFluxSource()` — creates Flux `OCIRepository` pinned to `config.digest`
   - Constants: `DEFAULT_REGISTRY_HOST = 'ghcr.io'`, `DEFAULT_RELEASE_REPOSITORY = 'nine-minds/alga-appliance-release'`

8. **`ee/appliance/host-service/resolve-control-plane-image.mjs`** (all, ~50 lines) — Resolves the control-plane image ref by calling `resolveReleaseManifest()` and emitting `manifest.controlPlane`. Used by `bootstrap-control-plane.sh` for in-place control-plane updates.

9. **`ee/appliance/host-service/update-engine.mjs`** (lines 1-100) — The app-channel update flow: re-resolves the manifest from OCI, applies new runtime values, and reconciles Flux.

10. **`ee/appliance/host-service/status-engine.mjs`** (line 7) — Reads release selection from `release-selection.json`.

11. **`ee/appliance/operator/lib/releases.mjs`** (all, ~85 lines) — Operator-side release resolver for script-driven installs (reads local `release.json` + `channels/*.json`).

12. **`ee/appliance/operator/lib/status.mjs`** (lines 123-145, 840-863) — `parseDesiredAlgaCoreImages()` extracts the desired `setup.image` / `server.image` from ConfigMap values; `parseActualAlgaCoreImages()` reads the live Deployment's init container / main container images; `imageDrift` detection compares them.

13. **`ee/appliance/scripts/repair-release.sh`** (all, ~100 lines) — Repair script that deletes failed bootstrap jobs + alga-core pods, then runs `flux reconcile helmrelease alga-core`.

14. **`ee/appliance/docs/registry-metadata-design.md`** (all, ~90 lines) — Design document for the full OCI-based registry metadata architecture.

15. **`ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml`** (lines 1-40) — Profile values template with `setup.image.name: ghcr.io/nine-minds/alga-psa-ee` and `server.image.name: ghcr.io/nine-minds/alga-psa-ee`. Tags are injected at runtime from the manifest.

16. **`ee/appliance/flux/base/releases/alga-core.yaml`** (lines 1-45) — Flux HelmRelease referencing chart `sebastian` from `HelmRepository alga-charts`; values come from ConfigMap `appliance-values-alga-core`.

---

## Key Code

### release.json format (source of truth for image tags)

```json
// ee/appliance/releases/1.0/release.json
{
  "releaseVersion": "1.0",
  "generatedAt": "2026-06-04T22:00:00Z",
  "app": {
    "version": "1.0",
    "releaseBranch": "release/1.0.0",
    "valuesProfile": "single-node",
    "images": {
      "algaCore": "eaec6253",
      "workflowWorker": "a2cbb43",
      "emailService": "61e4a00e",
      "temporalWorker": "a2cbb43"
    }
  }
}
```

The `algaCore` tag (`"eaec6253"`) is a short SHA — the complete image reference is **`ghcr.io/nine-minds/alga-psa-ee:eaec6253`**. The tag is NOT a full registry URL; it's a tag pushed during CI/image builds.

### OCI release manifest (what gets published to GHCR)

Built by `build-release-manifest.py` (line 68-80):
```python
manifest = {
    "schema": "alga.appliance.release/v1",
    "version": args.release_version,
    "channel": args.channel,
    "valuesProfile": args.profile,
    "images": images,                    # from release.json -> app.images
    "controlPlane": args.control_plane or None,
    "config": {
        "repository": args.config_repository,
        "tag": args.config_tag or args.release_version,
        "digest": args.config_digest,
    },
    "charts": charts,                    # chart versions from Chart.yaml
    "profileValues": profile_values,     # per-service YAML values
}
```

### algaCore tag → image injection (consume side)

In `setup-engine.mjs` (lines 974-976):
```javascript
if (images.algaCore) {
    values[`alga-core.${profile}.yaml`] = setYamlScalar(
        values[`alga-core.${profile}.yaml`],
        ['setup', 'image', 'tag'], yamlString(images.algaCore));
    values[`alga-core.${profile}.yaml`] = setYamlScalar(
        values[`alga-core.${profile}.yaml`],
        ['server', 'image', 'tag'], yamlString(images.algaCore));
}
```

The profile values template already has `setup.image.name: ghcr.io/nine-minds/alga-psa-ee` and `server.image.name: ghcr.io/nine-minds/alga-psa-ee`. So injecting the tag produces the full image reference: **`ghcr.io/nine-minds/alga-psa-ee:eaec6253`**.

### OCI resolution (network path, no git)

`resolveReleaseManifest()` in `setup-engine.mjs` (lines 353-370):
1. Fetches anonymous pull token: `GET /token?scope=repository:nine-minds/alga-appliance-release:pull`
2. Fetches manifest: `GET /v2/nine-minds/alga-appliance-release/manifests/<channel>` (e.g., `:stable`)
3. Reads `config.digest` from the OCI manifest descriptor
4. Fetches config blob: `GET /v2/nine-minds/alga-appliance-release/blobs/<digest>`
5. Parses the config blob as the release manifest JSON
6. Calls `validateReleaseManifest()` which requires `images.algaCore` and `config.digest`

### Flux source: OCIRepository (no GitRepository)

`applyFluxSource()` in `setup-engine.mjs` (lines 1117-1162):
```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: alga-appliance
  namespace: flux-system
spec:
  interval: 1m0s
  url: oci://ghcr.io/nine-minds/alga-appliance-config
  ref:
    digest: sha256:...      # pinned by digest from manifest.config.digest
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: alga-appliance
spec:
  sourceRef:
    kind: OCIRepository
```

The HelmRelease inside the config bundle references OCI charts via `sourceRef: { kind: HelmRepository, name: alga-charts }` with versions pinned by `manifest.charts[name]`.

---

## Architecture

### Data Flow

```
CI/build-images.sh                          publish-appliance-release.sh
    │                                              │
    │  --alga-core-tag eaec6253                    │
    ▼                                              ▼
release.json  ──────►  build-release-manifest.py ──►  oras push → ghcr.io/nine-minds/alga-appliance-release:1.0
(algaCore: eaec6253)       + charts/versions              + oras tag → :stable
                           + config digest
                           + control-plane ref            Also: helm push charts + flux push artifact
                           + profile values

                              │
                              ▼  (appliance boot / update)
                    resolveReleaseManifest()
                    ↓
                    GET ghcr.io/v2/.../manifests/stable
                    ↓
                    Parse config blob → release manifest JSON
                    ↓
                    validateReleaseManifest()
                      - requires images.algaCore
                      - requires config.repository + config.digest
                    ↓
                    applyRuntimeValuesAndReleaseSelection()
                      - Injects images.algaCore into setup.image.tag & server.image.tag
                      - Creates appliance-values-* ConfigMaps
                      - Creates appliance-release-selection ConfigMap
                    ↓
                    applyFluxSource()
                      - Creates OCIRepository (pinned to config.digest)
                      - Creates Kustomization
                    ↓
                    Flux reconciles → HelmRelease alga-core
                    → Deployment alga-core-sebastian
                    → Pod pulls ghcr.io/nine-minds/alga-psa-ee:eaec6253
```

### Image Reference Pattern

All images follow the pattern:
- **algaCore**: `ghcr.io/nine-minds/alga-psa-ee:<short-sha>` (e.g., `eaec6253`)
- **workflowWorker**: `ghcr.io/nine-minds/alga-psa-ee-workflow-worker:<short-sha>`
- **emailService**: `ghcr.io/nine-minds/alga-psa-ee-email-service:<short-sha>`
- **temporalWorker**: `ghcr.io/nine-minds/alga-psa-ee-temporal-worker:<short-sha>`

The image name is hardcoded in the profile values YAML (`setup.image.name: ghcr.io/nine-minds/alga-psa-ee`). Only the tag is injected dynamically.

### Channel → Version indirection

- `release.json` files are stored in git under `ee/appliance/releases/<version>/release.json`
- `channels/stable.json` maps channel name → release version
- When published, the **channel tag** (`:stable`) on the OCI artifact is the indirection pointer
- The publish script tags the same artifact with both `:<version>` and `:<channel>`

---

## Start Here

**`ee/appliance/scripts/publish-appliance-release.sh`** — This is the single entry point that ties everything together: it reads from `release.json`, packages charts, pushes the flux config bundle, builds the OCI release manifest, and pushes it to GHCR. Every artifact and step flows from here.

For the consume/resolution side, start with **`ee/appliance/host-service/setup-engine.mjs`**, specifically:
- `resolveReleaseManifest()` (~line 353) — the OCI fetch + validation
- `applyRuntimeValuesAndReleaseSelection()` (~line 943) — image tag injection

### Verification: confirming the pinned algaCore image

On a running appliance, check:
```bash
# 1. Read the release selection ConfigMap (shows what was resolved)
kubectl -n alga-system get configmap appliance-release-selection -o yaml
# → algaCoreTag, releaseVersion, selectedChannel

# 2. Read the runtime values ConfigMap (shows the injected tag)
kubectl -n alga-system get configmap appliance-values-alga-core -o yaml
# → server.image.tag and setup.image.tag show the pinned SHA

# 3. Check the live Deployment image
kubectl -n msp get deployment alga-core-sebastian -o jsonpath='{.spec.template.spec.containers[0].image}'
# → ghcr.io/nine-minds/alga-psa-ee:eaec6253

# 4. Operator status (if available) shows imageDrift detection
alga appliance status  # → compares desired vs actual images

# 5. Pull the OCI release manifest directly using oras
oras manifest fetch ghcr.io/nine-minds/alga-appliance-release:stable --descriptor \
  | jq -r '.digest' \
  | xargs -I{} sh -c 'oras manifest fetch "ghcr.io/nine-minds/alga-appliance-release@{}" | jq -r ".config.digest" | xargs -I{} oras blob fetch "ghcr.io/nine-minds/alga-appliance-release@{}" --output - | jq .'
```
