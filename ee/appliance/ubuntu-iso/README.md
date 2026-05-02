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

Expected inputs:

- A base Ubuntu Server 24.04 LTS ISO path (`--base-iso`).
- A release version string (`--release-version`).

Expected outputs:

- `output/alga-appliance-ubuntu-<release-version>.iso`
- `output/alga-appliance-ubuntu-<release-version>.sha256`

## Current Status

This commit establishes the layout and build interface (`F001`).

Autoinstall seed files now live in `config/nocloud/user-data` and `config/nocloud/meta-data`.

Subsequent features add host service artifacts and full ISO remastering.
