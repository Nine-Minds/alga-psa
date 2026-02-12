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
- (2026-02-12) Migrated billing service deletion to deleteEntityWithValidation + DeleteEntityDialog, added preCheckDeletion preview and deactivate alternative in ServiceCatalogManager; deleteService now returns validation result for dialog handling.
- (2026-02-12) Migrated billing tax rate deletion to DeleteEntityDialog + deleteEntityWithValidation with dependency preview via preCheckDeletion; removed custom confirm dialog flow in TaxRates.
- (2026-02-12) Migrated invoice template deletion to DeleteEntityDialog + deleteEntityWithValidation; added preCheckDeletion preview and expanded invoice_template deletion config to include clients and conditional rules.
- (2026-02-12) Migrated ticket deletion to deleteEntityWithValidation with DeleteEntityDialog preview in TicketingDashboard; removed manual ticket tag cleanup and updated bulk delete to use validation helper.
- (2026-02-12) Migrated project deletion to deleteEntityWithValidation + DeleteEntityDialog with preCheckDeletion preview; added project task tag cleanup via deleteEntitiesTags and removed manual project task tag deletion in ProjectTask model.
- (2026-02-12) Wired reference-data category deletion to deleteEntityWithValidation and added DeleteEntityDialog + preCheckDeletion preview in TicketingConfigStep.
- (2026-02-12) Added dynamic status deletion dependencies in core config; migrated status deletion actions/UI to DeleteEntityDialog with preCheckDeletion and deleteEntityWithValidation (ProjectStatusSettings + onboarding statuses).
