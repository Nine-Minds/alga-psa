# PRD — Extension Version Immutability and Version Viewer

- Slug: `extension-version-immutability-and-viewer`
- Date: `2026-02-10`
- Status: Draft

## Summary

Implement three changes to the extension publishing/management workflow:

1. Friendly duplicate-version errors during publish/finalize.
2. A read-only versions viewer in Extension Settings.
3. Strict version immutability (a version string can be published once per extension; no reuse).

## Problem

Extension publish currently has two operator-facing gaps:

- Duplicate version failures can surface as non-friendly or low-context errors (especially race/constraint paths).
- Users cannot see existing published versions in product UI, so they guess version values when publishing.

In addition, current registry behavior can associate multiple content hashes to the same version, which undermines cache and invalidation expectations.

## Goals

- Publish attempts that reuse an existing version return a clear, actionable error.
- Users can view published versions (read-only) for an extension in settings.
- Enforce strict immutability: once a version exists for a registry entry, publishing that version again is rejected.
- Keep scope limited to core behavior requested above.

## Non-goals

- Version deletion/invalidation UI controls.
- Runner cache purge endpoint or automatic cache eviction workflow.
- Install-history timeline beyond current install state.
- New role model/permission model beyond existing extension read/manage permissions.

## Users and Primary Flows

### Persona: Extension publisher (admin/developer)

1. User uploads a bundle whose `manifest.json` version already exists.
2. Finalize fails with a friendly conflict message identifying the duplicate version.
3. User navigates to extension details, opens versions list, and selects a new version for next publish.

### Persona: Extension operator (tenant admin)

1. User opens extension details in settings.
2. User sees current installed version and list of published versions with metadata (version, publish time, content hash).
3. User uses this info for troubleshooting and controlled updates.

## UX / UI Notes

- Add a read-only “Versions” section to Extension Details.
- Display rows sorted newest first.
- Suggested columns: `Version`, `Published`, `Content hash`, `Installed`.
- Show explicit empty state if no versions are available.
- No edit/delete controls in this scope.

## Requirements

### Functional Requirements

1. Publishing/finalize path rejects duplicate version reuse for the same registry extension with HTTP `409`.
2. Duplicate-version rejection applies regardless of whether incoming content hash matches prior content hash.
3. Duplicate-version responses include a stable machine code and human-friendly message.
4. Race-condition unique-constraint failures are mapped to the same friendly duplicate-version response.
5. Duplicate publish attempts must not create additional `extension_bundle` rows for that version.
6. Add backend read query/action to list extension versions and associated latest bundle metadata.
7. Version list includes installed marker for current tenant install version.
8. Extension Details page renders the read-only versions table using backend query/action.
9. Existing install/update/uninstall flows continue to work unchanged.

### Non-functional Requirements

1. No schema migration is required for this scope.
2. Version viewer query is bounded to one extension and tenant context.
3. Error text is concise and safe for UI/CLI display.

## Data / API / Integrations

- Existing tables: `extension_registry`, `extension_version`, `extension_bundle`, `tenant_extension_install`.
- Strict immutability enforced in registry v2 finalize path (`upsertVersionFromManifest`/equivalent).
- Existing finalize endpoint and server action must return consistent error payloads for UI + CLI consumers.
- Version viewer uses existing extension settings data flow and permission checks.

## Security / Permissions

- Version viewer requires existing extension read permission.
- Publish/finalize immutability enforcement remains under existing extension manage/install permissions.
- Do not expose tenant-external extension data.

## Observability

- No new telemetry required in this scope.
- Reuse existing server logs; ensure duplicate-version conflict path logs enough context for debugging (extension id + version, without leaking secrets).

## Rollout / Migration

- Forward-only behavior change: after deployment, duplicate version publish attempts fail deterministically.
- Existing historical data with reused versions remains as-is; this plan does not retroactively normalize prior duplicates.
- Viewer should tolerate legacy data where a version has multiple bundles by selecting deterministic latest bundle metadata for display.

## Open Questions

1. Friendly message exact wording and code format (`VERSION_ALREADY_EXISTS` vs existing house style).
2. In viewer, whether to show only latest bundle hash per version or include a “multiple bundles” indicator for legacy rows.

## Acceptance Criteria (Definition of Done)

- [ ] Publishing a bundle with an already-used version returns friendly `409` duplicate-version response in both UI and CLI paths.
- [ ] Reusing a version never creates a new bundle association.
- [ ] Extension Details has a read-only versions viewer listing published versions and installed marker.
- [ ] Version viewer handles empty state and legacy duplicate-bundle versions without runtime errors.
- [ ] Automated tests cover duplicate-version rejection (including race path) and versions-viewer data rendering.
