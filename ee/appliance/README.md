# Talos Appliance Assets

This directory owns appliance-specific assets and automation for Alga PSA.

Current responsibilities:

- Flux deployment profiles under `flux/`
- Talos Image Factory schematics under `schematics/`
- Talos/appliance release metadata under `releases/`
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

## Appliance bootstrap

Use `ee/appliance/scripts/bootstrap-site.sh` to apply the Talos single-node Flux profile.

The bootstrap script requires explicit image tags for each Alga application image:

- `--alga-core-tag`
- `--workflow-worker-tag`
- `--email-service-tag`
- `--temporal-worker-tag`

If you omit them in interactive mode, the script prompts for each one individually. It does not default application images to `latest`.

Example:

```bash
ee/appliance/scripts/bootstrap-site.sh \
  --kubeconfig /path/to/kubeconfig \
  --alga-core-tag 61e4a00e \
  --workflow-worker-tag 61e4a00e \
  --email-service-tag 61e4a00e \
  --temporal-worker-tag 61e4a00e
```
