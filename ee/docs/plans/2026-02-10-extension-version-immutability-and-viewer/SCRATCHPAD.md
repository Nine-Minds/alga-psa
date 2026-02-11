# Scratchpad — Extension Version Immutability and Version Viewer

- Plan slug: `extension-version-immutability-and-viewer`
- Created: `2026-02-10`

## What This Is

Working notes for implementing extension publish duplicate handling, strict version immutability, and a read-only versions viewer.

## Decisions

- (2026-02-10) Scope locked to three outcomes only: friendly duplicate-version errors, read-only versions viewer, strict immutability.
- (2026-02-10) Strict immutability means version reuse is rejected even when content hash is identical.
- (2026-02-10) Viewer is read-only in Extension Details; no invalidation/delete controls in this phase.

## Discoveries / Constraints

- (2026-02-10) CLI and UI publish flows converge on `extFinalizeUpload` and `upsertVersionFromManifest`.
- (2026-02-10) Current registry v2 behavior allows version reuse and can attach multiple bundle hashes to one version.
- (2026-02-10) Existing UI only surfaces current installed version; there is no full versions list UI.
- (2026-02-10) Runner static ext-ui path is hash-addressed and heavily cached; strict immutability reduces future reuse ambiguity but does not clean up historical rows.

## Commands / Runbooks

- (2026-02-10) Scaffolded plan: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Extension Version Immutability and Version Viewer" --slug extension-version-immutability-and-viewer`
- (2026-02-10) Validate plan artifacts: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-10-extension-version-immutability-and-viewer`

## Links / References

- Publish flow entry: `sdk/alga-client-sdk/src/lib/publish.ts`
- UI installer flow: `ee/server/src/components/settings/extensions/InstallerPanel.tsx`
- Finalize action: `ee/server/src/lib/actions/extBundleActions.ts`
- Registry v2 upsert semantics: `ee/server/src/lib/extensions/registry-v2.ts`
- Versions list helper (existing internal): `ee/server/src/lib/extensions/registry-v2-repo-knex.ts`
- Extension settings list/details UI: `ee/server/src/components/settings/extensions/Extensions.tsx`, `ee/server/src/components/settings/extensions/ExtensionDetails.tsx`
- Runner ext-ui caching/validation: `ee/runner/src/http/ext_ui.rs`, `ee/runner/src/registry/client.rs`, `ee/runner/src/engine/loader.rs`

## Open Questions

- Should viewer expose only latest hash per version, or also a legacy “multiple bundles” indicator for versions that already have >1 hash?
- Exact duplicate-version error code string to align with existing API error naming conventions.

## Implementation Progress
- (2026-02-10) Completed F001: Define duplicate-version API contract for finalize: HTTP 409 + stable error code + friendly message
- (2026-02-10) Completed F002: Update registry-v2 finalize version upsert path to enforce strict immutability (reject existing version regardless of hash)
- (2026-02-10) Completed F003: Remove/disable duplicate-version branch that currently appends a new bundle hash to an existing version
- (2026-02-10) Completed F004: Map DB unique-constraint races for (registry_id, version) to the same friendly duplicate-version 409 response
- (2026-02-10) Completed F005: Ensure ext-bundles/finalize route and server action return consistent duplicate-version error payloads for UI and CLI callers
- (2026-02-10) Completed F006: Update installer/publish UI flow to surface duplicate-version message directly to users
- (2026-02-10) Completed F007: Add registry query/action to list all versions for a registry extension in tenant context
- (2026-02-10) Completed F008: Include in version list payload: version string, created/published timestamp, latest content hash metadata
- (2026-02-10) Completed F009: Include installed marker in version list payload by joining tenant_extension_install.version_id
- (2026-02-10) Completed F010: Handle legacy version rows with multiple bundles by deterministically selecting latest bundle metadata in viewer payload
- (2026-02-10) Completed F011: Render read-only Versions section in Extension Details page
- (2026-02-10) Completed F012: Versions table shows columns Version, Published, Content hash, Installed
- (2026-02-10) Completed F013: Versions section includes explicit empty state when no versions exist
- (2026-02-10) Completed F014: Enforce existing permission checks for version listing (extension read scope)
- (2026-02-10) Completed F015: Add tests for duplicate-version friendly response in both direct duplicate and race-condition paths
- (2026-02-10) Completed F016: Add tests for strict immutability guaranteeing no new bundle rows are created when version already exists
- (2026-02-10) Completed F017: Add tests for versions viewer backend query covering installed marker and legacy multi-bundle versions
- (2026-02-10) Completed F018: Add UI tests for Extension Details versions section rendering, sorting, and empty state
- (2026-02-10) Completed T001: Finalize returns HTTP 409 with stable duplicate-version error code when manifest version already exists for extension
- (2026-02-10) Completed T002: Duplicate-version 409 payload includes user-friendly message with conflicting version value
- (2026-02-10) Completed T003: Finalize rejects duplicate version when incoming content hash is identical to existing bundle hash
- (2026-02-10) Completed T004: Finalize rejects duplicate version when incoming content hash differs from existing bundle hash
- (2026-02-10) Completed T005: Version-upsert path does not create a new extension_bundle row for duplicate version attempts
- (2026-02-10) Completed T006: Concurrent finalize requests for same publisher/name/version map losing request to friendly duplicate-version 409
- (2026-02-10) Completed T007: DB unique violation for (registry_id, version) is normalized to duplicate-version code and message
- (2026-02-10) Completed T008: Finalize HTTP route returns same duplicate-version payload shape as server action result
- (2026-02-10) Completed T009: Installer UI shows duplicate-version friendly message from finalize response without generic fallback text
- (2026-02-10) Completed T010: CLI publish surfaces duplicate-version response message from finalize path
- (2026-02-10) Completed T011: Version list backend returns all versions for given registry extension sorted newest first
- (2026-02-10) Completed T012: Version list backend includes version string and publish timestamp fields for each row
- (2026-02-10) Completed T013: Version list backend includes deterministic latest content hash metadata per version
- (2026-02-10) Completed T014: Version list marks installed=true only for row matching tenant_extension_install.version_id
- (2026-02-10) Completed T015: Version list handles extension with no install row by returning all rows installed=false
- (2026-02-10) Completed T016: Legacy data case: one version with multiple bundle rows still returns one deterministic viewer row
