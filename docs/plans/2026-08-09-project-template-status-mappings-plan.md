# Project-template status mapping repair plan

## Problem

Project templates currently persist every referenced status in `project_template_status_mappings.status_id`. That single UUID is later interpreted by probing catalogs, and `applyProjectTemplate` always writes it to `project_status_mappings.status_id` with `is_standard = false`. A standard-status UUID therefore becomes a tenant-status FK value and can fail with PostgreSQL `23503`. Deleted tenant statuses can also leave dangling template mappings because status deletion validation does not count template references and the template table has no status FK.

The repair must make reference type explicit, preserve existing template mapping identity and task assignments, quarantine historical ambiguity, and prevent apply from making partial projects.

## Code-grounded current state

- `packages/projects/src/services/applyProjectTemplate.ts` resolves effective template mappings but emits tenant/custom `project_status_mappings` rows regardless of the source catalog.
- `packages/projects/src/actions/projectTemplateActions.ts` includes `createTemplateFromProject` and `getTemplateWithDetails`; creation collapses references into `status_id`, while detail loading probes standard and tenant catalogs rather than reading an explicit type.
- `packages/projects/src/actions/projectTemplateWizardActions.ts` persists the wizard model through the same collapsed `status_id` shape, including copy/save-as-new paths.
- `packages/projects/src/components/project-templates/TemplateStatusManager.tsx` and `wizard-steps/TemplateStatusColumnsStep.tsx` already edit mappings and retain temporary/mapping identity while changing row content. The persisted replacement path should mirror that behavior without deleting the mapping row.
- `packages/projects/src/components/project-templates/TemplateEditor.tsx`, `TemplateDetail.tsx`, and `ApplyTemplateDialog.tsx` are the entry points for Manage Status Columns and Apply Template.
- `packages/core/src/config/deletion/index.ts` is the centralized dependency registry used by status deletion validation, but template mappings are not registered as a dependency.
- `server/migrations/20260610150000_make_standard_statuses_global.cjs` already rewrites template status UUIDs during standard-status canonicalization and is the precedent for Citus-safe, sequential catalog migration work.
- The initial template schema gives `project_template_status_mappings` a tenant-scoped primary key, `status_id`, inline `custom_status_name`/`custom_status_color`, and no status FK. `20260318101000_add_template_phase_id_to_project_template_status_mappings.cjs` adds phase scope.

## Chosen design

Use exclusive typed reference columns on each persisted mapping and represent historical uncertainty explicitly. Do not infer type at read or apply time.

Each row is one of four variants:

1. `tenant`: `status_id` references a tenant status; `standard_status_id` and `unresolved_status_id` are null.
2. `standard`: `standard_status_id` references the global standard catalog; `status_id` and `unresolved_status_id` are null.
3. `inline`: `custom_status_name` defines a template-owned status to create; all reference UUID columns are null.
4. `unresolved`: `unresolved_status_id` preserves the historical UUID; typed reference columns are null. Optional reason metadata distinguishes `missing` from `ambiguous`.

Add a constrained discriminator such as `status_source` (`tenant | standard | inline | unresolved`) rather than relying on nullable-column shape alone. A database check constraint enforces the matching exclusive column combination. This is slightly more schema than two nullable typed columns, but it prevents future callers from recreating the current ambiguity and makes API/UI exhaustiveness testable.

Rejected approaches:

- Keep one UUID and probe catalogs: this preserves the bug and makes UUID collisions/absence ambiguous.
- Prefer one catalog when both match: historical ambiguity would be silently corrupted.
- Delete and recreate broken mappings: this changes `template_status_mapping_id` and breaks template-task assignments.
- Store only a free-form kind plus one UUID: it cannot use type-specific FKs and is easier to write inconsistently.

## Schema and migration

Add a new migration under `server/migrations/` following the Citus sequencing pattern in `20260610150000_make_standard_statuses_global.cjs`.

1. Add nullable columns:
   - `standard_status_id uuid`
   - `unresolved_status_id uuid`
   - `unresolved_reason text` or a constrained short string
   - `status_source varchar` initially nullable for backfill
2. Backfill every existing row in one deterministic transaction per tenant/distribution-safe batch:
   - Existing inline custom rows with no `status_id` become `inline`.
   - A UUID found only in the same tenant status catalog becomes `tenant` and stays in `status_id`.
   - A UUID found only in `standard_statuses` becomes `standard`; move it from `status_id` to `standard_status_id`.
   - A UUID found in neither catalog becomes `unresolved`; move it to `unresolved_status_id` with reason `missing`.
   - A UUID found in both catalogs, or a row whose populated columns conflict, becomes `unresolved` with reason `ambiguous`. Preserve the original UUID and never guess.
3. Add the discriminator/shape check after backfill, then make `status_source` non-null.
4. Add the tenant-scoped custom-status FK using the repository's tenant/Citus-compatible composite-key convention. Add the global standard-status FK if the global catalog is a Citus reference table; otherwise enforce it in the migration validation and service layer and document why a physical FK is not supported.
5. Add indexes for `(tenant, status_id)`, `standard_status_id`, and `(tenant, status_source)` to support deletion checks and unresolved counts.
6. Validate constraints only after the deterministic rewrite. The migration must report counts by source and fail before adding constraints if any row does not fit one variant.

The down migration must be loss-aware: collapse `standard_status_id` and `unresolved_status_id` back into `status_id` before dropping new columns, preserving every UUID. It may remove type safety, but it must not discard evidence needed for manual repair.

## Shared typed resolver

Add a server-only utility near `packages/projects/src/lib/projectStatusMappingUtils.ts`, for example `projectTemplateStatusMappingResolution.ts`, with a discriminated union:

```ts
type ResolvedTemplateStatusMapping =
  | { source: 'tenant'; statusId: string; mappingId: string }
  | { source: 'standard'; standardStatusId: string; mappingId: string }
  | { source: 'inline'; name: string; color?: string; mappingId: string }
  | { source: 'unresolved'; originalStatusId?: string; reason: 'missing' | 'ambiguous'; mappingId: string };
```

The utility should:

- decode only valid database shapes;
- batch-load referenced tenant and standard rows for display metadata;
- return `unresolved` if a referenced target has disappeared after migration rather than throwing or relabeling it;
- provide `assertTemplateMappingsResolved` for apply preflight;
- be used by actions, service, and UI DTO construction so catalog precedence exists in one place.

## Write paths

Update all creation and copy paths to write explicit variants:

- `createTemplateFromProject` in `projectTemplateActions.ts` should preserve whether each source project mapping uses `status_id` or `standard_status_id` and carry `is_standard` into the explicit template variant.
- `createTemplateFromWizard` and `saveTemplateAsNew` in `projectTemplateWizardActions.ts` should accept a discriminated mapping DTO. Convert the current client model once at the action boundary and reject contradictory shapes.
- Existing create/update actions used by `TemplateStatusManager` should write the typed fields atomically and return the hydrated typed DTO.
- `getTemplateWithDetails` should no longer probe standard before tenant. It should call the shared resolver and expose `statusSource`, display metadata, and unresolved reason.

Add `replaceTemplateStatusMapping(templateId, templateStatusMappingId, replacement)` as an authenticated tenant-scoped transaction:

1. Lock and validate the exact mapping belongs to the template and tenant.
2. Validate the replacement target exists in the chosen catalog.
3. Update the existing row in place, clearing all columns from the old variant and setting exactly the new variant.
4. Preserve `template_status_mapping_id`, `template_id`, `template_phase_id`, and `display_order`.
5. Do not rewrite or delete template tasks. Their existing mapping/assignment references continue to point at the same mapping ID.
6. Return the refreshed mapping DTO and current unresolved count.

This action is also the repair mechanism for missing and ambiguous historical rows; no separate destructive replacement flow is needed.

## Apply flow

Refactor `applyProjectTemplate.ts` into an explicit preflight followed by mutation:

1. Load the template, effective default/phase mappings, and typed resolution in a tenant transaction.
2. If any effective mapping is unresolved, return a structured domain error before creating the project or phases:
   - code: `TEMPLATE_STATUS_MAPPINGS_UNRESOLVED`
   - safe message: `This template has status columns that must be repaired before it can be applied.`
   - details: template ID, affected mapping IDs/scopes, and a repair route; do not expose raw SQL/FK errors.
3. For each resolved mapping:
   - `tenant`: insert `project_status_mappings.status_id`, set `standard_status_id = null`, `is_standard = false`.
   - `standard`: insert `project_status_mappings.standard_status_id`, set `status_id = null`, `is_standard = true`.
   - `inline`: create/resolve the template-owned tenant status as current behavior requires, then insert the tenant mapping.
4. Keep the project, phases, mappings, and task creation in the existing transaction so any later failure rolls back the entire apply.
5. Translate unexpected constraint failures into the shared safe action error while logging identifiers and database detail server-side.

The server preflight is authoritative. UI disabling is a convenience and must not be the only guard.

## Deletion safety

Extend the project-status entity entry in `packages/core/src/config/deletion/index.ts` with a dependency on `project_template_status_mappings.status_id`, tenant-scoped by the existing deletion framework. The result should name the dependent templates and link to project templates where supported.

For the first release, block deletion when a tenant status is referenced by any template and direct the user to replace those mappings in Manage Status Columns. Do not silently convert mappings to unresolved during delete; that turns an explicit safe block into latent template breakage. Standard-status deletion is outside this tenant UI and remains governed by its catalog lifecycle.

Add an integration assertion that the deletion precheck and actual deletion action share the same guard so a direct server-action call cannot bypass the UI.

## UI behavior

### Manage Status Columns

Update `TemplateStatusManager.tsx` and its caller in `TemplateEditor.tsx` to render the typed DTO:

- Resolved tenant/standard/inline mappings show normal name/color metadata and a source-aware accessible label where useful.
- Unresolved mappings remain in their existing order and show `Status no longer exists` plus `Missing status` or `Ambiguous historical status` helper text.
- Provide an in-place `Replace status` control on the row. Choosing a target calls `replaceTemplateStatusMapping`; optimistic UI is allowed only after the server accepts the replacement.
- Keep the same row key/mapping ID so any task assignment to that mapping remains selected.
- Refresh the template unresolved count after replacement and show a success/error toast with safe text.

The wizard step `TemplateStatusColumnsStep.tsx` should use the same discriminated client type for newly authored mappings, but historical unresolved repair belongs to the persisted template editor rather than the creation wizard.

### Apply entry points

Update `TemplateDetail.tsx`/`TemplateEditor.tsx` and `ApplyTemplateDialog.tsx`:

- Surface `unresolvedStatusMappingCount` from `getTemplateWithDetails` or a compact template-health DTO.
- Disable `Use Template`/Apply while the count is non-zero.
- Show an inline explanation and a `Repair status columns` link/button that opens or navigates to Manage Status Columns.
- If state changes between render and submit, display the server's structured unresolved error and the same repair action.
- Never show the generic Server Components or raw FK error to the user.

Add translation keys with English fallbacks for the missing label, repair action, apply guard, ambiguous reason, and safe apply error.

## Behavioral test plan

Prefer DB-backed tests using the migrated tenant schema. Do not add tests that only inspect source text, imports, or SQL strings.

1. `applyProjectTemplate` integration tests in `packages/projects/src/services/`:
   - standard mapping creates a project mapping with only `standard_status_id` and `is_standard = true`;
   - tenant mapping creates one with only `status_id` and `is_standard = false`;
   - inline custom mapping creates/resolves the tenant status and links it correctly;
   - unresolved mapping returns `TEMPLATE_STATUS_MAPPINGS_UNRESOLVED` and creates no project/phases/tasks.
2. Migration/backfill integration coverage using real PostgreSQL:
   - standard-only, tenant-only, missing, and deliberately ambiguous fixtures land in the expected variant;
   - original UUIDs survive unresolved quarantine;
   - constraints reject contradictory typed shapes;
   - rerunning the deterministic data-repair portion is idempotent where the migration harness supports it.
3. Replacement action integration tests in `packages/projects/src/actions/`:
   - replacing missing with tenant and standard targets updates the same `template_status_mapping_id`;
   - `template_phase_id`, order, and template task assignments remain unchanged;
   - cross-tenant, nonexistent, and contradictory replacements are rejected without mutation.
4. Deletion behavior:
   - a tenant status referenced by a template appears in deletion dependencies and cannot be deleted;
   - after in-place replacement removes the final reference, the normal deletion path can proceed.
5. Component/UI behavior with runtime rendering:
   - `TemplateStatusManager` renders `Status no longer exists` and replacement control for unresolved DTOs;
   - a successful replacement retains the row/task selection and clears the warning;
   - `Use Template` is disabled with a repair link while unresolved mappings exist and re-enables after repair;
   - submit-time unresolved server errors render the safe message and repair action.

Run the focused package tests plus the repository's normal typecheck/build command for changed packages. If migration behavior differs under Citus, include the repository's Citus migration validation before PR.

## Implementation order

1. Add the migration, typed schema/DTO definitions, and resolver with migration tests.
2. Convert every create/copy/detail write/read path to the explicit variant model.
3. Add apply preflight and correct exclusive project-mapping inserts with DB-backed tests.
4. Add the in-place replacement action and deletion dependency guard with integration tests.
5. Update Template Status Manager and Apply entry points, then add component behavior tests and translations.
6. Run focused tests, full relevant typecheck/build, and a manual local smoke: broken template shows repair UI; replacement preserves assignments; apply succeeds after repair.

## Non-goals

- Redesigning project status lifecycle or the global standard-status catalog.
- Automatically selecting a replacement for missing/ambiguous historical rows.
- Deleting/recreating template mapping rows or task assignments.
- A bulk repair wizard in the first release; per-row in-place repair is sufficient and safer.
- Broad changes to unrelated project-template phases, resources, dependencies, or checklists.

## Risks and safeguards

- **Citus FK limitations:** follow existing tenant-colocation/reference-table patterns and test in a Citus-enabled migration environment before validation.
- **Historical UUID collision:** classify as ambiguous and require human replacement; never choose by query order.
- **Partial apply:** perform unresolved preflight before mutation and retain the single transaction.
- **Writer drift:** use one discriminated DTO and database check constraint so old/new callers cannot write mixed shapes silently.
- **Task-assignment loss:** update mappings in place and assert identity/assignments in integration tests.
- **Race with status deletion:** lock/validate replacement and rely on the new FK/deletion guard; surface a safe retryable error if the target disappears.
- **Rollback:** down migration preserves every typed or unresolved UUID when collapsing; application deploy should be ordered migration first, code second, with old readers tolerated only during the deployment window.

## Acceptance criteria

- Applying templates with standard and tenant statuses writes correct exclusive project mapping columns and no FK error.
- Missing or ambiguous mappings are visible and repairable without changing mapping ID or task assignments.
- Apply is blocked in both UI and server until all effective mappings resolve.
- Referenced tenant statuses cannot be deleted until template mappings are replaced.
- Existing deterministic rows migrate automatically; ambiguous rows remain safely unresolved with their original UUID.
- Behavioral DB and UI tests cover standard, tenant, missing, replacement, deletion guard, and ambiguous repair paths.
