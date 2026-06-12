# First-Party Workflow Integration Module Registry Pattern

Use `getWorkflowIntegrationModuleRegistry().register(...)` to define first-party workflow modules that should appear as stable Workflow Designer app tiles.

## Required metadata

- `groupKey`: app namespace key (`app:<name>`)
- `label`: operator-facing module name
- `description`: short module intent
- `tileKind`: currently `app`
- `iconToken`: palette icon token
- `defaultActionId`: default action when adding module
- `allowedActionIds`: explicit action allow-list for module dropdown
- `availabilityKey`: declarative runtime availability key (for tenant filtering)

## Current availability resolver

Availability is resolved server-side in `listWorkflowDesignerActionCatalogAction` using keyed checks. Current first key:

- `rmm:ninjaone`: true only when tenant has an active NinjaOne row in `rmm_integrations` (`provider='ninjaone'`, `is_active=true`, `connected_at IS NOT NULL`).

## Integration authoring checklist

1. Register actions in runtime initialization paths used by both server/publish and worker execution.
2. Register the module with explicit `allowedActionIds` and `availabilityKey`.
3. Use operator-facing labels/descriptions in action metadata.
4. Keep sensitive credentials out of action outputs.
5. Add catalog + handler tests and availability tests.
