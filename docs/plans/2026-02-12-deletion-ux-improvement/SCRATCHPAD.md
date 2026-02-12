# Scratchpad — Deletion UX Improvement

- Plan slug: `deletion-ux-improvement`
- Created: `2026-02-12`
- Source plan: `.ai/deletion_improvement_plan.md` (v2, schema-verified)

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-02-12) **Plain functions over class**: `DeletionValidationService` class replaced with plain exported functions in `deletionValidation.ts`. Codebase uses functional patterns everywhere (server actions, model methods, utilities). No instance state in the service = no reason for a class.
- (2026-02-12) **Atomic validate-and-delete**: `deleteEntityWithValidation` runs validation + tag cleanup + deletion in a single `withTransaction` call. Prevents TOCTOU race condition present in current `deleteClient` (separate transactions for validation and deletion).
- (2026-02-12) **Separate read-only precheck**: `preCheckDeletion` kept as a separate action for the dialog preview step (when dialog opens). This is read-only and lightweight.
- (2026-02-12) **DeleteEntityDialog as new component**: Created as a new component in `@alga-psa/ui`, NOT a modification of existing `ConfirmationDialog`. The deletion UX (dependency lists, alternatives, loading states) is complex enough to warrant its own component. ConfirmationDialog stays general-purpose.
- (2026-02-12) **Alternative action dispatch by action type string**: `onAlternativeAction('deactivate')` instead of magic handler name strings like `markClientInactive`. The component consumer maps action types to their own handlers.
- (2026-02-12) **Automatic tag cleanup via config**: `tagEntityType` field in `EntityDeletionConfig` triggers automatic `deleteEntityTags` call in `deleteEntityWithValidation`. Eliminates manual tag cleanup calls scattered across packages.
- (2026-02-12) **Package is @alga-psa/ui, not @alga-psa/ui-kit**: Verified that `ConfirmationDialog`, `Dialog`, `Button` etc. are all in `@alga-psa/ui`. The `@alga-psa/ui-kit` package exists separately but is not the target.

## Discoveries / Constraints

- (2026-02-12) **Schema corrections from v1 plan** — multiple foreign key names were wrong:
  - `company_id` → `client_id` everywhere (contacts, tickets, projects, invoices, assets, interactions)
  - `user_team_members` → actual table is `team_members`
  - `company_billing_plans` → does not exist; contracts use `contract_lines` + `client_contracts`
  - `company_tax_settings.tax_rate_id` → column doesn't exist; use `client_tax_rates.tax_rate_id`
  - `schedule_entries.user_id` → doesn't exist; users are assigned via `schedule_entry_assignees` (M2M join table)
  - `invoices.tax_rate_id` → doesn't exist; tax rates link via `client_tax_rates`
- (2026-02-12) **Client deletion checks `is_default`**: The default company cannot be deleted. This is an entity-specific precondition that runs before the generic validation. Other entities may have similar preconditions.
- (2026-02-12) **Tag cleanup currently integrated in 4 places**: tickets, clients, contacts, project tasks. Missing from: projects (parent entity), assets, documents, and others.
- (2026-02-12) **Cascade tag cleanup for projects**: When deleting a project, child tasks need bulk tag cleanup via `deleteEntitiesTags(trx, taskIds, 'project_task')`.
- (2026-02-12) **ConfirmationDialog has 3-button support**: Uses `thirdButtonLabel` + `onCancel` for three-way choices. Used by TagManager, TaskForm, ClientDetails, BoardsSettings. This is general-purpose, NOT deletion-specific.
- (2026-02-12) **ConfirmationDialog has radio options**: `options` prop renders radio buttons, used for recurring event scope selection. Also NOT deletion-specific.
- (2026-02-12) **Status entity has dynamic deps**: Status dependencies depend on `status_type` (ticket statuses check tickets.status_id, interaction statuses check interactions.status_id). Needs special handling in the action, not in static config.
- (2026-02-12) **Permission helper variants**: Some packages use `hasPermission` directly, others use `hasPermissionAsync()` wrapper to avoid circular dependencies. Watch for this during migration.
- (2026-02-12) **`notes_document_id` cleanup**: Several entities (clients, contacts) have a `notes_document_id` that needs cleanup during deletion. This is entity-specific logic in `performDelete`, not part of the generic system.

## Commands / Runbooks

- (2026-02-12) **Verify schema**: `docker exec -e PGPASSWORD="$(cat secrets/db_password_server)" bigmac_postgres psql -h localhost -p 5432 -U app_user -d server -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'TABLE_NAME'"`
- (2026-02-12) **Docker compose project**: `bigmac` (detected from container names like `bigmac_postgres`)
- (2026-02-12) **DB access**: Exposed on port 5433, credentials in `server/.env` + `secrets/db_password_server`

## Links / References

- Source plan: `/Users/natalliabukhtsik/Desktop/projects/bigmac/.ai/deletion_improvement_plan.md`
- Client deletion (gold standard): `packages/clients/src/actions/clientActions.ts:832-1123`
- Client dialog usage: `packages/clients/src/components/clients/ClientDetails.tsx:1262-1365`
- ConfirmationDialog: `packages/ui/src/components/ConfirmationDialog.tsx`
- Existing DeleteConfirmationDialog wrapper: `packages/ui/src/components/settings/dialogs/DeleteConfirmationDialog.tsx`
- Tag cleanup utilities: `packages/tags/src/lib/tagCleanup.ts`
- Tag migration: `server/migrations/20250702000000_normalize_tags_with_mappings.cjs`

## Open Questions

- Should DeleteEntityDialog support dark mode styling from the start? (active dark mode work on `dark_times` branch)
- For cascade entities (tickets, projects), should the dialog explain what gets cascade-deleted?
- Should bulk delete in TicketingDashboard use validateBulkDeletion immediately or defer to P3?

- (2026-02-12) Added deletion type definitions in packages/types/src/deletion.ts (DeletionValidationResult, DeletionDependency, DeletionAlternative) for shared deletion UX types.
- (2026-02-12) Added DeletionBlockCode union and wired it into DeletionValidationResult.code.
- (2026-02-12) Added EntityDeletionConfig and EntityDependencyConfig types (with tagEntityType) to deletion types.
- (2026-02-12) Exported deletion types from packages/types/src/index.ts barrel.
- (2026-02-12) Implemented validateDeletion with dependency counting, custom countQuery support, pluralized labels, block message, alternatives, and viewUrl template expansion.
- (2026-02-12) Added schema-verified deletion configs for core entities plus getDeletionConfig lookup in packages/core/src/config/deletion/index.ts.
- (2026-02-12) Added deletion actions (preCheckDeletion, deleteEntityWithValidation, validateBulkDeletion), permission checks, and exports; added useDeletionValidation hook.
- (2026-02-12) Added DeleteEntityDialog component with validation states, dependency list, alternatives, and loading states; exported from @alga-psa/ui.
- (2026-02-12) Refactored client deletion to use deleteEntityWithValidation, added validateClientDeletion precheck, removed manual tag cleanup, and swapped ClientDetails delete dialog to DeleteEntityDialog with preview + alternative action wiring.
- (2026-02-12) Refactored contact deletion to use deleteEntityWithValidation and DeleteEntityDialog; removed manual tag cleanup in contactActions.
- (2026-02-12) Updated user deletion action to use deleteEntityWithValidation and wired UserManagementSettings to DeleteEntityDialog with dependency preview and deactivate alternative.
- (2026-02-12) Migrated team deletion to deleteEntityWithValidation and updated TeamList to use DeleteEntityDialog with dependency preview.
- (2026-02-12) Migrated contract line deletion to deleteEntityWithValidation and updated ContractLines UI to use DeleteEntityDialog with dependency preview.
- (2026-02-12) Added deletion type tests (deletion.test.ts) covering T001-T005; marked T001 complete.
- (2026-02-12) Marked T002 complete for DeletionDependency type coverage.
- (2026-02-12) Marked T003 complete for DeletionAlternative type coverage.
- (2026-02-12) Marked T004 complete for EntityDeletionConfig tagEntityType coverage.
- (2026-02-12) Marked T005 complete for deletion type barrel exports coverage.
- (2026-02-12) Added validateDeletion unit tests (T006-T018 coverage started); marked T006 complete.
- (2026-02-12) Marked T007 complete for validateDeletion dependency block coverage.
- (2026-02-12) Marked T008 complete for validateDeletion foreignKey counting coverage.
- (2026-02-12) Marked T009 complete for validateDeletion custom countQuery coverage.
- (2026-02-12) Marked T010 complete for validateDeletion singular label formatting.
- (2026-02-12) Marked T011 complete for validateDeletion plural label formatting.
- (2026-02-12) Marked T012 complete for validateDeletion label endings in 's'.
- (2026-02-12) Marked T013 complete for validateDeletion block message formatting.
- (2026-02-12) Marked T014 complete for validateDeletion inactive alternative.
- (2026-02-12) Marked T015 complete for validateDeletion archive alternative.
- (2026-02-12) Marked T016 complete for validateDeletion no-alternatives case.
- (2026-02-12) Marked T017 complete for validateDeletion viewUrl templates.
- (2026-02-12) Marked T018 complete for validateDeletion missing viewUrlTemplate.
- (2026-02-12) Added deletion config tests (T019-T030 coverage started); marked T019 complete.
- (2026-02-12) Marked T020 complete for client document_associations countQuery.
- (2026-02-12) Marked T021 complete for client inactive/tagEntityType config.
- (2026-02-12) Marked T022 complete for contact foreign key config.
- (2026-02-12) Marked T023 complete for contact portal user countQuery.
- (2026-02-12) Marked T024 complete for team_members dependency config.
- (2026-02-12) Marked T025 complete for schedule_entry_assignees dependency config.
- (2026-02-12) Marked T026 complete for contract_line usage_tracking foreign key.
- (2026-02-12) Marked T027 complete for client_tax_rates dependency config.
- (2026-02-12) Marked T028 complete for board category dependency config.
- (2026-02-12) Marked T029 complete for getDeletionConfig known entity coverage.
- (2026-02-12) Marked T030 complete for getDeletionConfig unknown entity coverage.
- (2026-02-12) Added deletion action tests (T031-T066 coverage started); marked T031 complete.
- (2026-02-12) Marked T032 complete for preCheckDeletion permission denial.
- (2026-02-12) Marked T033 complete for preCheckDeletion client permission mapping.
- (2026-02-12) Marked T034 complete for preCheckDeletion canDelete true.
- (2026-02-12) Marked T035 complete for preCheckDeletion dependency list.
- (2026-02-12) Marked T036 complete for preCheckDeletion unknown entity.
- (2026-02-12) Marked T037 complete for deleteEntityWithValidation single transaction.
- (2026-02-12) Marked T038 complete for deleteEntityWithValidation skip on failed validation.
- (2026-02-12) Marked T039 complete for deleteEntityWithValidation tag cleanup order.
- (2026-02-12) Marked T040 complete for deleteEntityWithValidation no tag cleanup when unset.
- (2026-02-12) Marked T041 complete for deleteEntityWithValidation success result.
- (2026-02-12) Marked T042 complete for deleteEntityWithValidation dependency re-check.
- (2026-02-12) Marked T043 complete for deleteEntityWithValidation rollback behavior.
- (2026-02-12) Added DeleteEntityDialog tests (T044-T058 coverage started); marked T044 complete.
- (2026-02-12) Marked T045 complete for DeleteEntityDialog confirmation message.
- (2026-02-12) Marked T046 complete for DeleteEntityDialog delete button.
- (2026-02-12) Marked T047 complete for DeleteEntityDialog cannot-delete title.
- (2026-02-12) Marked T048 complete for DeleteEntityDialog dependency list.
- (2026-02-12) Marked T049 complete for DeleteEntityDialog view links.
- (2026-02-12) Marked T050 complete for DeleteEntityDialog missing view link.
- (2026-02-12) Marked T051 complete for DeleteEntityDialog primary alternative.
- (2026-02-12) Marked T052 complete for DeleteEntityDialog secondary alternative styling.
- (2026-02-12) Marked T053 complete for DeleteEntityDialog no-alternatives case.
- (2026-02-12) Marked T054 complete for DeleteEntityDialog deleting spinners.
- (2026-02-12) Marked T055 complete for DeleteEntityDialog disabled buttons while deleting.
- (2026-02-12) Marked T056 complete for DeleteEntityDialog alternative action handler.
- (2026-02-12) Marked T057 complete for DeleteEntityDialog cancel handler.
- (2026-02-12) Marked T058 complete for DeleteEntityDialog confirm handler.
- (2026-02-12) Added useDeletionValidation hook tests (T059-T062 coverage started); marked T059 complete.
- (2026-02-12) Marked T060 complete for useDeletionValidation validationResult.
- (2026-02-12) Marked T061 complete for useDeletionValidation error handling.
- (2026-02-12) Marked T062 complete for useDeletionValidation reset behavior.
- (2026-02-12) Marked T063 complete for validateBulkDeletion single transaction.
- (2026-02-12) Marked T064 complete for validateBulkDeletion all-pass case.
- (2026-02-12) Marked T065 complete for validateBulkDeletion partial failure case.
- (2026-02-12) Marked T066 complete for validateBulkDeletion unknown entity handling.
- (2026-02-12) Added deletion migration tests (T067-T099 coverage started) and migration updates for categories, interaction types, and boards; marked T067 complete.
- (2026-02-12) Marked T068 complete for client IS_DEFAULT precondition.
- (2026-02-12) Marked T069 complete for client tag cleanup removal.
- (2026-02-12) Marked T070 complete for ClientDetails DeleteEntityDialog usage.
- (2026-02-12) Marked T071 complete for ClientDetails delete preview validation.
- (2026-02-12) Marked T072 complete for ClientDetails deactivate alternative wiring.
- (2026-02-12) Marked T073 complete for ClientDetails dependency JSX removal.
- (2026-02-12) Marked T074 complete for contact deletion migration coverage.
- (2026-02-12) Marked T075 complete for contact tag cleanup removal.
- (2026-02-12) Marked T076 complete for user deletion migration coverage.
- (2026-02-12) Marked T077 complete for team deletion migration coverage.
- (2026-02-12) Marked T078 complete for contract line deletion migration coverage.
- (2026-02-12) Migrated billing service deletion to deleteEntityWithValidation + DeleteEntityDialog, added preCheckDeletion preview and deactivate alternative in ServiceCatalogManager; deleteService now returns validation result for dialog handling.
- (2026-02-12) Migrated billing tax rate deletion to DeleteEntityDialog + deleteEntityWithValidation with dependency preview via preCheckDeletion; removed custom confirm dialog flow in TaxRates.
- (2026-02-12) Migrated invoice template deletion to DeleteEntityDialog + deleteEntityWithValidation; added preCheckDeletion preview and expanded invoice_template deletion config to include clients and conditional rules.
- (2026-02-12) Migrated ticket deletion to deleteEntityWithValidation with DeleteEntityDialog preview in TicketingDashboard; removed manual ticket tag cleanup and updated bulk delete to use validation helper.
- (2026-02-12) Migrated project deletion to deleteEntityWithValidation + DeleteEntityDialog with preCheckDeletion preview; added project task tag cleanup via deleteEntitiesTags and removed manual project task tag deletion in ProjectTask model.
- (2026-02-12) Wired reference-data category deletion to deleteEntityWithValidation and added DeleteEntityDialog + preCheckDeletion preview in TicketingConfigStep.
- (2026-02-12) Added dynamic status deletion dependencies in core config; migrated status deletion actions/UI to DeleteEntityDialog with preCheckDeletion and deleteEntityWithValidation (ProjectStatusSettings + onboarding statuses).
- (2026-02-12) Migrated priority deletion to deleteEntityWithValidation and DeleteEntityDialog (PrioritySettings + onboarding priorities) with ITIL-standard guard via validatePriorityDeletion.
- (2026-02-12) Migrated board deletion in onboarding to DeleteEntityDialog + preCheckDeletion and routed reference-data board deletion through deleteEntityWithValidation.
- (2026-02-12) Migrated document deletion to deleteEntityWithValidation and DeleteEntityDialog in DocumentStorageCard; updated deleteDocument to return validation result and adjusted bulk delete handling.
- (2026-02-12) Migrated asset deletion to deleteEntityWithValidation and DeleteEntityDialog (DeleteAssetButton), with dependency preview via preCheckDeletion.
- (2026-02-12) **Schedule entry deletion migrated**: deleteScheduleEntry now uses deleteEntityWithValidation, preserves private-entry checks, returns DeletionValidationResult, and permission mapping now treats schedule_entry as user_schedule. Updated ScheduleCalendar and EntryPopup to use DeleteEntityDialog with preCheckDeletion and recurrence-scope selection; WeeklyScheduleEvent now defers delete confirmation to ScheduleCalendar dialog. Technician dispatch ScheduleEvent now uses DeleteEntityDialog with preview and validates before delete; delete pipeline returns validation results for dialog display.
- (2026-02-12) **Lint note**: eslint still reports pre-existing warnings and the feature-to-feature import error in TechnicianDispatchDashboard (scheduling -> tickets). Not introduced by this change.
- (2026-02-12) **Survey template deletion migrated**: Added survey_template deletion config (survey_triggers, survey_invitations, survey_responses deps) and mapped survey_template permissions to settings for delete checks. deleteSurveyTemplate now uses deleteEntityWithValidation and returns DeletionValidationResult. TemplateList + TemplateForm now use DeleteEntityDialog with preCheckDeletion for preview and deletion.
- (2026-02-12) **Lint note**: surveys eslint still reports existing feature-to-feature import error (surveys -> tickets) and warnings unrelated to this change.
- (2026-02-12) **Workflow deletion migrated**: Added preCheckWorkflowDefinitionDeletion and updated deleteWorkflowDefinitionAction to use deleteEntityWithValidation with active-run/system checks returning DeletionValidationResult. WorkflowList now uses DeleteEntityDialog with dependency preview and handles validation failures; bulk delete respects new result shape. Updated deletion permission checks to use workflow 'manage' action (no delete permission exists) via permissionActionFor.
- (2026-02-12) **Lint note**: workflows eslint shows many pre-existing warnings; no new errors.
- (2026-02-12) **Role deletion migrated**: deleteRole now uses deleteEntityWithValidation with admin-role guard and returns DeletionValidationResult. RoleManagement uses DeleteEntityDialog with preCheckDeletion preview and handles validation failures. Added permission mapping for role deletions to security_settings.
- (2026-02-12) **Lint note**: auth package retains pre-existing warnings (unused Flex/Text, handleUpdateRole, explicit any).
- (2026-02-12) **Interaction type deletion migrated**: deleteReferenceDataItem now routes interaction_types through deleteEntityWithValidation using interaction_type config. No dedicated UI entrypoint found for interaction type settings; action now returns DeletionValidationResult for DeleteEntityDialog usage where applicable.
- (2026-02-12) **Lint note**: reference-data eslint warnings are pre-existing.
