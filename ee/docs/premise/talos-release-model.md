# Talos Release Model

## Purpose

The Talos appliance release model exists to make the OS layer deterministic. A release must identify exactly which Talos boot media, installer image, and application profile belong together.

## Source Of Truth

The release contract lives in:

- `ee/appliance/schematics/`
- `ee/appliance/releases/<release>/release.json`
- `ee/appliance/releases/schema.json`
- `ee/appliance/scripts/build-images.sh`

The repository does not currently build Talos images locally with Packer or VM-specific tooling. Instead, it uses SideroLabs Image Factory and records the resulting artifact pair in the release manifest.

## Required Artifact Pair

Every Talos appliance release should produce exactly these OS-level outputs for the supported platform:

1. A Talos ISO boot asset.
2. The matching Talos installer image reference for the same Talos version and schematic.

Those two artifacts must stay paired. Do not mix:

- an ISO from one schematic with an installer image from another
- an ISO from one Talos version with an installer image from another

If those diverge, installation and later machine configuration behavior become unreliable.

## Release Manifest Contract

The release manifest records:

- appliance release version
- Talos version
- Talos schematic ID
- schematic source path in the repo
- Kubernetes version paired with that Talos release
- ISO URL, local path, and SHA-256
- installer image reference and digest when available
- customer-facing application version marker
- source app release branch, using the existing `release/<version>` naming scheme
- exact pinned component image tags used by the appliance upgrade/bootstrap path
- appliance values profile name
- release channel

The schema in `ee/appliance/releases/schema.json` should be treated as authoritative for the manifest shape.

## Build Flow

`ee/appliance/scripts/build-images.sh` owns the release build contract:

1. Load the in-repo schematic.
2. Submit it to Image Factory, unless a schematic ID override is supplied.
3. Resolve the schematic ID.
4. Construct the ISO URL and matching installer image reference.
5. Download the ISO.
6. Compute the local SHA-256.
7. Write `release.json`.

The script is intentionally strict. A release should fail if:

- the schematic file is missing
- Image Factory does not return a schematic ID
- the ISO cannot be downloaded
- the ISO checksum cannot be computed
- the installer image cannot be derived from the same schematic and version pair

## Schematic Discipline

The schematic should remain minimal unless the appliance has a concrete host-level need for:

- an extension
- a kernel argument
- a driver requirement
- a different platform target

The current `metal-amd64` schematic is intentionally sparse. That is a feature, not a gap. Host behavior should stay simple until there is a clear appliance requirement that belongs in the OS image.

## Release Management Rules

Treat these as invariants:

- A release manifest should be immutable once published.
- Candidate and stable channels may point at different release manifests, but each manifest must be internally consistent.
- Operators should bootstrap machines from the manifest, not from remembered ad hoc URLs.
- Local VM or site-specific notes should reference the manifest rather than copying values out of it.

## Implication For Operators

When troubleshooting Talos bootstrap, the first question should be: "Which release manifest are we actually using?" If that is unclear, the rest of the diagnosis is weak because the ISO, installer image, and expected Kubernetes version may not actually match.
