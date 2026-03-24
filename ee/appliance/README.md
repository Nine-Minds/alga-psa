# Talos Appliance Assets

This directory owns appliance-specific assets and automation for Alga PSA.

For the stable operating model and generic Talos appliance assumptions, start with:

- `ee/docs/premise/README.md`
- `ee/docs/premise/talos-release-model.md`
- `ee/docs/premise/talos-host-configuration.md`
- `ee/docs/premise/talos-gitops-bootstrap.md`
- `ee/docs/premise/talos-alga-bootstrap-and-persistence.md`
- `ee/docs/premise/talos-operations-and-troubleshooting.md`

Current responsibilities:

- Flux deployment profiles under `flux/`
- Talos Image Factory schematics under `schematics/`
- Talos/appliance release metadata under `releases/`
- Storage prerequisites under `manifests/`
- Appliance helper scripts under `scripts/`

## Talos image scaffolding

The repository generates real Talos boot artifacts through the public Image Factory instead of local Packer templates.

First-pass supported outputs:

- `metal-amd64.iso`
- matching `factory.talos.dev/metal-installer/<schematic-id>:<talos-version>` reference

Build command:

```bash
ee/appliance/scripts/build-images.sh \
  --release-version 0.0.1 \
  --talos-version v1.12.0 \
  --kubernetes-version v1.31.4 \
  --app-version main
```

Dry-run example:

```bash
EE_APPLIANCE_SCHEMATIC_ID_OVERRIDE=testschematic \
ee/appliance/scripts/build-images.sh \
  --release-version 0.0.1 \
  --talos-version v1.12.0 \
  --kubernetes-version v1.31.4 \
  --app-version main \
  --dry-run
```

The build script writes:

- ISO artifacts under `dist/appliance/<release-version>/`
- release metadata under `ee/appliance/releases/<release-version>/release.json`

The release manifest couples the Talos version, schematic ID, ISO URL/checksum, and installer image so later bootstrap flows can consume one deterministic contract.

## Guided appliance bootstrap

Use `ee/appliance/scripts/bootstrap-appliance.sh` as the primary operator entrypoint.

It can:

- generate and persist Talos machine config for a fresh node
- run in explicit `fresh` or `recover` bootstrap mode
- bootstrap Talos and write durable `talosconfig` and `kubeconfig`
- install the local-path storage prerequisite and verify it
- install Flux and point it at `ee/appliance/flux/base`
- render runtime values with explicit per-service image tags
- create or reuse the shared application secret
- wait for the first-run `alga-core` bootstrap job and app rollout

Example fresh bring-up:

```bash
ee/appliance/scripts/bootstrap-appliance.sh \
  --release-version 0.0.1 \
  --bootstrap-mode fresh \
  --node-ip 192.168.64.5 \
  --hostname alga-appliance \
  --app-url https://psa.example.com \
  --interface enp0s1 \
  --network-mode dhcp \
  --repo-url https://github.com/Nine-Minds/alga-psa.git \
  --repo-branch feature/on-prem-enterprise-helm-install \
  --alga-core-tag 1b0a9c0b \
  --workflow-worker-tag 61e4a00e \
  --email-service-tag 61e4a00e \
  --temporal-worker-tag 61e4a00e
```

`--app-url` controls the public URLs injected into the app runtime, including `NEXTAUTH_URL`, `NEXT_PUBLIC_BASE_URL`, and `NEXT_PUBLIC_APP_URL`.

If you already have a running cluster and kubeconfig, the same script can be used with `--kubeconfig` to skip Talos first-boot work.

Bootstrap mode semantics:

- `fresh`: deletes the appliance namespaces and wipes `/opt/local-path-provisioner` on the node before reinstalling
- `recover`: preserves existing PVC-backed appliance state and refuses to generate new database credentials against an existing Postgres PVC

Use the destructive reset helper directly when you need to clear persisted appliance data between test runs:

```bash
ee/appliance/scripts/reset-appliance-data.sh \
  --kubeconfig ~/nm-kube-config/alga-psa/talos/appliance-single-node/kubeconfig \
  --force
```

`ee/appliance/scripts/bootstrap-site.sh` remains as a compatibility wrapper around `bootstrap-appliance.sh`.

## Support bundles

Use `ee/appliance/scripts/collect-support-bundle.sh` to export the standard diagnostics package for support.

Example:

```bash
ee/appliance/scripts/collect-support-bundle.sh \
  --kubeconfig ~/nm-kube-config/alga-psa/talos/appliance-single-node/kubeconfig \
  --talosconfig ~/nm-kube-config/alga-psa/talos/appliance-single-node/talosconfig \
  --node-ip 192.168.64.5 \
  --site-id appliance-single-node
```
