# Workflow Import/Export (Versioned Bundle Format) — PRD

**Plan date:** 2026-01-25  
**Owner:** TBD  
**Status:** Draft (needs answers to Open Questions)

## 1) Problem Statement
Alga PSA’s Workflow Runtime V2 stores workflows as JSON “workflow definitions” in the database (`workflow_definitions` + `workflow_definition_versions`). We need a **stable, file-based import/export format** so that:

1. We can **preload workflows into the system for testing** (fixtures that can be version-controlled).
2. Over time, users can **share workflows across instances** (cross-tenant sharing, customer-to-customer).
3. Eventually, workflows could be distributed via a marketplace.

Today there is no stable, documented workflow file format and no supported import/export pathway.

## 2) Goals
### V1 goals (testing + foundation)
1. Define a **single, versioned workflow bundle file format** with full behavioral fidelity for Workflow Runtime V2 workflows.
2. Implement **export** of one or more workflows into that file format.
3. Implement **import** of that file format into a fresh or existing instance with predictable “create/upsert” behavior.
4. The application declares the **single accepted format version** (e.g. `formatVersion: 1`) and rejects other versions.
5. Document the format and provide a machine-checkable schema.
6. Add automated tests that prove:
   - Imported workflows can be published/executed successfully.
   - Export → import → export can be round-tripped (canonicalized) for supported cases.

## 3) Non-Goals (V1)
- Backwards compatibility across format versions (beyond “reject with a clear error”).
- A full end-user UI for import/export (we can expose internal APIs usable by tests and later wrap in UI).
- Exporting/importing workflow **run history** (runs, logs, waits, snapshots).
- Automatically bundling/transferring external dependencies that are not part of the workflow definition system (e.g., credentials/secrets); the format may reference them, but resolution is an import-time concern.

## 4) Users / Personas
- **Developers / QA:** want deterministic workflow fixtures for tests and local repros.
- **Admins (future):** want to move/share workflows between instances.

## 5) Proposed Approach
### 5.1 File format: `workflow-bundle.json`
Use a JSON document (“bundle”) that can contain one or more workflows and their published versions.

Key properties:
- **Explicit format header** and **format version**.
- **Canonical JSON export** (deterministic ordering + indentation) to support stable diffs and round-trip tests.
- Contains all data needed to recreate workflow behavior in another instance, without relying on DB-specific timestamps/ids.

### 5.2 Versioning policy
- V1 accepts exactly one `formatVersion` (initially `1`).
- Import rejects bundles whose `formatVersion !== ACCEPTED_VERSION` with a clear error message.
- No attempt is made to auto-migrate older/newer bundle versions.

### 5.3 “Full fidelity” definition (V1)
“Full fidelity” means importing a bundle recreates the workflow’s **functional behavior** and operational settings, including:
- Draft definition JSON and draft version.
- Published definition versions (definition JSON + payload schema JSON snapshot, if present).
- Trigger definition and payload schema configuration.
- Operational flags/settings (paused, visibility, concurrency limit, retention policy override, auto-pause/failure thresholds).

It explicitly does **not** require preserving:
- Instance-specific audit fields (created/updated timestamps, created_by/updated_by/published_by).
- Database-generated ids (version_id), unless we choose to preserve workflow ids as an option.

### 5.4 Bundle schema (conceptual)
At a minimum:

```jsonc
{
  "format": "alga-psa.workflow-bundle",
  "formatVersion": 1,
  "exportedAt": "2026-01-25T00:00:00.000Z",
  "workflows": [
    {
      "key": "system.email-processing", // stable external identifier
      "metadata": {
        "name": "System Email Processing",
        "description": "…",
        "payloadSchemaRef": "payload.InboundEmail.v1",
        "payloadSchemaMode": "inferred",
        "pinnedPayloadSchemaRef": null,
        "trigger": { "type": "event", "eventName": "INBOUND_EMAIL_RECEIVED" },
        "isSystem": true,
        "isVisible": true,
        "isPaused": false,
        "concurrencyLimit": null,
        "autoPauseOnFailure": false,
        "failureRateThreshold": null,
        "failureRateMinRuns": null,
        "retentionPolicyOverride": null
      },
      "draft": {
        "draftVersion": 1,
        "definition": { "version": 1, "name": "…", "payloadSchemaRef": "…", "steps": [] }
      },
      "publishedVersions": [
        {
          "version": 1,
          "definition": { "version": 1, "name": "…", "payloadSchemaRef": "…", "steps": [] },
          "payloadSchemaJson": { "type": "object" }
        }
      ]
    }
  ]
}
```

### 5.5 Dependency validation
Import should validate that the target instance has the required runtime registrations to execute the workflow:
- Action ids + versions referenced by `action.call` steps.
- Node types referenced by steps.
- Schema registry refs referenced by `payloadSchemaRef` and trigger mapping rules.

If dependencies are missing, import should fail with a structured error that lists missing items (so tests can register stubs, and future users can install extensions/providers).

For environment-specific resource references embedded in workflow definitions (e.g., connections/mailboxes/etc.), V1 will:
- Not define an explicit `dependencies` section in the bundle, and not scan arbitrary fields in the workflow definition.
- Perform the import in a single database transaction and **roll back on any error**.
- Lean on database constraints (FK/unique/not-null/domain constraints) to detect missing/invalid references where applicable.

### 5.6 Import semantics
We need deterministic behavior for “what happens if the workflow already exists?”:
- **Create-only (default)**: fail if `key` exists.
- **Force overwrite (opt-in)**: if `key` exists and `force=true`, delete the existing workflow (and its versions) and recreate it from the bundle with a newly generated `workflow_id`.

V1 should implement the policies above and be explicit about what gets overwritten and how versions are allocated.

### 5.7 Export semantics
V1 should support:
- Export a single workflow (by id) to a bundle file with one entry.
- Export a selected list of workflows (bundle).
- Canonical output so that exporting the same DB state yields the same file bytes.

## 6) API / UX (V1)
### 6.1 Initial surfaces (test-focused)
- API-only: server-side import/export via HTTP endpoints (no UI).
- Provide a CLI wrapper for import/export (for tests/fixtures and developer usage).

Suggested endpoints (exact paths are flexible):
- `GET /api/workflow-definitions/:workflowId/export` → returns `workflow-bundle.json` for a single workflow.
- `POST /api/workflow-definitions/import` → accepts a bundle JSON and imports it.

### 6.2 Future UI
- Admin UI can be added later using the same import/export APIs.

## 7) Documentation
Choose the docs location under `ee/docs/`:
- Schema: `ee/docs/schemas/workflow-bundle.v1.schema.json`
- Human-readable spec: `ee/docs/guides/workflows/workflow-import-export.md`

## 8) Risks & Mitigations
- **Hidden instance-specific ids inside workflow definitions** can break portability.
  - Mitigate by either (a) banning those references, (b) introducing “resource handles” and import mapping, or (c) declaring they are not portable in V1.
- **Schema registry dependencies** may not exist in target instance.
  - Mitigate with explicit dependency reporting and guidance.
- **Round-trip stability** can be hard if we include non-deterministic fields.
  - Mitigate by defining canonicalization rules and excluding audit timestamps from the format.

## 9) Open Questions (need answers)
Resolved:
1. Stable cross-instance identifier is a required `key` string (e.g. `system.email-processing`), distinct from DB `workflow_id`.
2. On import we always regenerate `workflow_id` (even when forcing overwrite of an existing workflow matched by `key`).
3. Workflows may reference environment-specific entities; V1 relies on transactional import + DB constraints to fail the import when such references are invalid/missing (where constraints exist).

Still open:
4. Whether we need additional explicit validation beyond DB constraints for specific reference types (if constraints are insufficient).

## 10) Definition of Done (V1)
- There is a documented, versioned workflow bundle format with a JSON schema in `ee/docs/`.
- A workflow can be exported into the bundle format.
- A bundle can be imported into a fresh instance and produces workflows that can be published and executed.
- Automated tests demonstrate execution and round-trip export/import behavior.
