# Talos Image Factory Scaffolding Design

- Date: `2026-03-10`
- Status: Approved

## Summary

Add real Talos v1.12 image scaffolding to the repository using SideroLabs Image Factory instead of the placeholder appliance image builder. The first pass should generate two deterministic artifacts for the `metal-amd64` platform:

1. a Talos ISO boot asset
2. the matching Talos installer image reference

The repository should own the schematic, release metadata, and artifact-resolution scripts. It should not yet own local VM launch helpers or first-boot cluster bootstrap changes.

## Architecture

`ee/appliance/` should own Talos image intent and release metadata. The current Flux deployment profile remains in place, but image generation moves to a new schematic-driven path:

- `ee/appliance/schematics/metal-amd64.yaml`
- `ee/appliance/scripts/build-images.sh`
- `ee/appliance/releases/<version>/release.json`
- `ee/appliance/releases/schema.json`
- `ee/appliance/releases/channels/{candidate,stable}.json`

The script flow is:

1. Load the in-repo Talos schematic YAML.
2. Submit the schematic to `https://factory.talos.dev/schematics`.
3. Read the returned schematic ID.
4. Construct the ISO URL for `metal-amd64.iso` using the schematic ID and Talos version.
5. Construct the matching installer image reference using the same schematic ID and Talos version.
6. Download the ISO, compute its SHA-256 digest locally, and write a release manifest that records the exact artifact pair.

## Artifact Contract

The release manifest should record real, consumable Talos artifacts rather than simulated files. Recommended fields:

- `releaseVersion`
- `generatedAt`
- `talos.version`
- `talos.schematicId`
- `talos.schematicPath`
- `kubernetes.version`
- `os.platform`
- `os.architecture`
- `os.iso.url`
- `os.iso.localPath`
- `os.iso.sha256`
- `os.installer.image`
- `os.installer.digest` when it can be resolved
- `app.version`
- `app.valuesProfile`
- `channel`

Behavior:

- fail if the schematic file is missing
- fail if schematic resolution does not return an ID
- fail if the ISO download fails
- fail if the ISO checksum cannot be computed
- fail if the installer image reference cannot be derived from the same schematic/version pair

## Implementation Boundary

This pass should:

- add the in-repo schematic file
- add a real Image Factory-backed `build-images.sh`
- add release schema and release channel scaffolding
- add docs/tests for the new image build path

This pass should not:

- launch a VM from the ISO
- apply machine configs
- bootstrap Flux
- deploy Alga workloads

## Validation

Required validation for this pass:

- script help and preflight behavior work locally
- dry-run mode renders the expected Image Factory URLs and installer image reference
- release schema validates the generated manifest shape
- the repository contains the approved scaffolding files and they are internally consistent
