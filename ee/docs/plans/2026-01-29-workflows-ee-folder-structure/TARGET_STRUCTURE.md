# Target folder structure (post-migration)

This describes the intended placement for the **EE Workflow UI** after migrating away from `packages/workflows/src/ee/**`.

## EE placement (`ee/server/src/**`)

- EE entrypoint file (aliased in Next config):
  - `ee/server/src/workflows/entry.tsx`
    - Exports a named `DnDFlow` export (shape required by `WorkflowComponentLoader`).
    - Re-exports the main Workflow Designer surface.

- EE workflow UI components:
  - Primary location stays within the EE server UI tree:
    - `ee/server/src/components/workflow-designer/**`
    - `ee/server/src/components/workflow-graph/**`
    - `ee/server/src/components/workflow-run-studio/**`

Rationale:

- Keeps EE-only UI co-located with other EE UI in `ee/server/src/components/**`.
- Keeps the runtime-selected entrypoint (`@alga-psa/workflows/entry`) as a single concrete file for deterministic bundling.

## Stable import surfaces (unchanged)

- App continues to import `@alga-psa/workflows/entry` (selected by aliasing).
- Shared workflow UI components that are not EE-only remain in `packages/workflows/src/components/**` and continue to be imported via `@alga-psa/workflows/components/*`.

