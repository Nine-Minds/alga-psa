# Ubuntu Appliance ISO Build Layout

This directory defines the Ubuntu Server 24.04 LTS appliance ISO build workspace.

## Purpose

The Ubuntu ISO path replaces Talos-based image generation for supported appliance installs.

This layout separates concerns so later plan items can evolve independently:

- `config/nocloud/`: autoinstall seed (`user-data`, `meta-data`) injected into the ISO.
- `overlay/`: host files copied into the installed system (systemd units, scripts, defaults).
- `scripts/`: repeatable build/validation automation.
- `work/`: ephemeral unpacked ISO workspace.
- `output/`: generated appliance ISO artifacts.

## Build Contract

`scripts/build-ubuntu-appliance-iso.sh` is the single entrypoint.
It stages host appliance artifacts through `scripts/stage-host-artifacts.sh`
into `overlay/opt/alga-appliance/` before ISO remaster steps.

Expected inputs:

- A base Ubuntu Server 24.04 LTS ISO path (`--base-iso`).
- A release version string (`--release-version`).

Expected outputs:

- `output/alga-appliance-ubuntu-<release-version>.iso`
- `output/alga-appliance-ubuntu-<release-version>.sha256`

## Preflight Gate Before UTM Smoke

Before spending time on a fresh UTM install, run the fail-fast appliance smoke preflight against the exact branch and ISO you intend to test:

```bash
node ee/appliance/ubuntu-iso/scripts/preflight-appliance-smoke.mjs \
  --repo-branch feature/on-premise-email-processing \
  --iso /Volumes/Extreme\ SSD/alga-appliance-smoke/iso-output/alga-appliance-ubuntu-smoke-YYYYMMDD-roundNN.iso
```

The preflight intentionally validates both sides of the install contract:

- local source files that are baked into the ISO;
- the selected remote Flux branch that the appliance will reconcile;
- the ISO overlay artifacts actually present on the image.

It fails if the smoke branch is blank, if the selected remote branch is stale or missing local HEAD, if HelmRelease retry policy is absent, if `appliance-status` binds the host network, if alga-core lacks a long first-install `progressDeadlineSeconds`, or if the packaged setup UI/API cannot preserve the support `repoBranch` override.

Use `--allow-channel-branch` only when intentionally validating a published channel branch. Use `--allow-unpushed` only for local exploratory checks; do not use it as a release/smoke gate.

## Current Status

This commit establishes the layout and build interface (`F001`).

Autoinstall seed files now live in `config/nocloud/user-data` and `config/nocloud/meta-data`.

Subsequent features add host service artifacts and full ISO remastering.
