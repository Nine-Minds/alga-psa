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
