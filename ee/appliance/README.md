# Appliance Assets (Ubuntu v1, Talos Legacy)

This directory owns appliance-specific assets and automation for Alga PSA.

Supported customer appliance path for v1 is Ubuntu Server 24.04 LTS with host setup/status service on port `8080`.
Talos assets in this tree are legacy/internal unless explicitly used by support or engineering.

For user-facing appliance installation and operation guides, start with:

- `ee/docs/appliance/README.md`
- `ee/docs/appliance/quick-start.md`
- `ee/docs/appliance/operators-manual.md`
- `ee/docs/appliance/technical-reference.md`

Legacy Talos reference docs (internal/support only):

- `ee/docs/premise/README.md`
- `ee/docs/premise/talos-release-model.md`
- `ee/docs/premise/talos-host-configuration.md`
- `ee/docs/premise/talos-gitops-bootstrap.md`
- `ee/docs/premise/talos-alga-bootstrap-and-persistence.md`
- `ee/docs/premise/talos-operations-and-troubleshooting.md`

Current responsibilities:

- Ubuntu appliance ISO workspace under `ubuntu-iso/`
- host setup/status/update service under `host-service/`
- Flux deployment profiles under `flux/`
- appliance release metadata under `releases/`
- Storage prerequisites under `manifests/`
- legacy/internal Talos helper scripts under `scripts/` and `schematics/`

## Legacy Talos image scaffolding

The repository still contains Talos boot artifact scaffolding for support/engineering reference. It is not the supported customer install path for Ubuntu v1.

Historical outputs:

- `metal-amd64.iso`
- matching `factory.talos.dev/metal-installer/<schematic-id>:<talos-version>` reference

Build command:

```bash
ee/appliance/scripts/build-images.sh \
  --release-version 1.0-rc5 \
  --talos-version v1.12.0 \
  --kubernetes-version v1.31.4 \
  --app-version 1.0-rc3 \
  --app-release-branch release/1.0-rc3 \
  --alga-core-tag 1b0a9c0b \
  --workflow-worker-tag 61e4a00e \
  --email-service-tag 61e4a00e \
  --temporal-worker-tag 61e4a00e
```

Dry-run example:

```bash
EE_APPLIANCE_SCHEMATIC_ID_OVERRIDE=testschematic \
ee/appliance/scripts/build-images.sh \
  --release-version 1.0-rc5 \
  --talos-version v1.12.0 \
  --kubernetes-version v1.31.4 \
  --app-version 1.0-rc3 \
  --app-release-branch release/1.0-rc3 \
  --alga-core-tag 1b0a9c0b \
  --workflow-worker-tag 61e4a00e \
  --email-service-tag 61e4a00e \
  --temporal-worker-tag 61e4a00e \
  --dry-run
```

The build script writes:

- ISO artifacts under `dist/appliance/<release-version>/`
- release metadata under `ee/appliance/releases/<release-version>/release.json`

The release manifest couples the Talos version, schematic ID, ISO URL/checksum, and installer image so later bootstrap flows can consume one deterministic contract.

## Legacy Talos operator workflow (internal only)

The `ee/appliance/appliance` Talos operator is gated by `ALGA_APPLIANCE_ALLOW_LEGACY_TALOS=1` and is retained for support/engineering only. Supported customer installs use the Ubuntu setup/status service on port `8080`.

Legacy TUI entrypoint:

```bash
ee/appliance/appliance tui
```

Legacy non-interactive usage:

```bash
ee/appliance/appliance bootstrap --bootstrap-mode recover --release-version 1.0-rc5
ee/appliance/appliance upgrade --release-version 1.0-rc5
ee/appliance/appliance reset --force
ee/appliance/appliance status
ee/appliance/appliance support-bundle --output-dir ./bundles
```

The shell scripts below are legacy Talos internals and support fallbacks.

## Legacy Talos bootstrap (script-level fallback)

`ee/appliance/scripts/bootstrap-appliance.sh` is not the Ubuntu v1 customer bootstrap path.

It can:

- generate and persist Talos machine config for a fresh node
- run in explicit `fresh` or `recover` bootstrap mode
- bootstrap Talos and write durable `talosconfig` and `kubeconfig`
- install the local-path storage prerequisite and verify it
- install Flux and point it at `ee/appliance/flux/base`
- render runtime values from the selected appliance release manifest
- create or reuse the shared application secret
- wait for the first-run `alga-core` bootstrap job and app rollout

Example fresh bring-up:

```bash
ee/appliance/scripts/bootstrap-appliance.sh \
  --release-version 1.0-rc5 \
  --bootstrap-mode fresh \
  --node-ip 192.168.64.5 \
  --hostname alga-appliance \
  --app-url https://psa.example.com \
  --interface enp0s1 \
  --network-mode dhcp \
  --repo-url https://github.com/Nine-Minds/alga-psa.git \
  --repo-branch release/1.0-rc3
```

`--app-url` controls the public URLs injected into the app runtime, including `NEXTAUTH_URL`, `NEXT_PUBLIC_BASE_URL`, and `NEXT_PUBLIC_APP_URL`.

The appliance release manifest now carries the customer-facing app release branch and exact component image tags. `bootstrap-appliance.sh` consumes those values by default, and the per-service tag flags are only needed for one-off overrides.

## Customer-controlled upgrades

Use `ee/appliance/scripts/upgrade-appliance.sh` to move an installed appliance to a published appliance release version.

Example:

```bash
ee/appliance/scripts/upgrade-appliance.sh \
  --release-version 1.0-rc5 \
  --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig
```

The script:

- reads the selected appliance release manifest
- updates the cluster-side appliance values `ConfigMap`s with the pinned component tags for that release
- records the chosen appliance release in `alga-system/appliance-release-selection`
- triggers a Flux/Helm reconcile for `alga-core`

Appliance `HelmRelease`s are configured with remediation retries disabled. Failed upgrades stop in place for support investigation instead of auto-rolling back through multiple attempts.

If you already have a running cluster and kubeconfig, the same script can be used with `--kubeconfig` to skip Talos first-boot work.

Bootstrap mode semantics:

- `fresh`: deletes the appliance namespaces and wipes `/var/mnt/alga-data/local-path-provisioner` on the node before reinstalling
- `recover`: preserves existing PVC-backed appliance state and refuses to generate new database credentials against an existing Postgres PVC

Use the destructive reset helper directly when you need to clear persisted appliance data between test runs:

```bash
ee/appliance/scripts/reset-appliance-data.sh \
  --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig \
  --force
```

`ee/appliance/scripts/bootstrap-site.sh` remains as a compatibility wrapper around `bootstrap-appliance.sh`.

## Support bundles

Use `ee/appliance/scripts/collect-support-bundle.sh` to export the standard diagnostics package for support.

Example:

```bash
ee/appliance/scripts/collect-support-bundle.sh \
  --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig \
  --talosconfig ~/.alga-psa-appliance/appliance-single-node/talosconfig \
  --node-ip 192.168.64.5 \
  --site-id appliance-single-node
```
