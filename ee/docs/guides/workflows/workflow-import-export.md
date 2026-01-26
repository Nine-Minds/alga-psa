# Workflow Import/Export (Workflow Bundle v1)

This guide documents Alga PSA Workflow Runtime V2’s file-based import/export format for workflows: the **workflow bundle**.

## Bundle file
- Filename: `workflow-bundle.json` (convention)
- Media type: `application/json`
- Canonical encoding: see [Canonical JSON](#canonical-json)

## Format header
Top-level required fields:
- `format`: must be exactly `alga-psa.workflow-bundle`
- `formatVersion`: must be exactly `1` (no automatic migration)
- `exportedAt`: ISO-8601 timestamp of when the bundle was generated
- `workflows`: array of one or more workflow entries

## Stable workflow identifier (`key`)
Each workflow entry has a required, portable identifier:
- `workflows[].key` (string)
- Recommended: DNS-like names (e.g. `system.email-processing`)
- Expected pattern: `^[a-z0-9][a-z0-9._-]*$`

This `key` is distinct from the database `workflow_id` and is the identity used for import create/upsert behavior.

## Workflow entry shape
Each `workflows[]` entry contains:
- `metadata`: name/description and operational settings required for behavioral fidelity
- `dependencies`: derived summary of required actions/node types/schema refs
- `draft`: draft version number + draft workflow definition JSON
- `publishedVersions`: zero or more published versions (each includes definition JSON and a payload schema snapshot if present)

The machine-checkable schema lives at `ee/docs/schemas/workflow-bundle.v1.schema.json`.

## Canonical JSON
Exports are written using canonical JSON rules to produce stable bytes suitable for diffs and round-trip tests:
- Recursively sort all object keys lexicographically
- Two-space indentation
- Trailing newline at end of file

## Dependencies
`workflows[].dependencies` is a best-effort summary derived from included workflow definitions. Import uses this to report missing runtime registrations (actions/node types/schema refs) in a structured way.

## Import semantics (v1)
Import runs all database writes in a single transaction and rolls back on any error.

Create/upsert policies:
- **Create-only (default):** if a workflow with the same `key` already exists, import fails.
- **Force overwrite (opt-in):** if `force=true`, import deletes the existing workflow (matched by `key`) and recreates it with a new `workflow_id`.

## Fidelity scope (v1)
Import/export aims to preserve functional workflow behavior and operational settings (draft + published versions + trigger + payload schema configuration + operational flags).

Not preserved:
- Audit fields (`created_at`, `updated_at`, `published_at`, actor ids)
- Database ids (including version ids); `workflow_id` is always regenerated on import
