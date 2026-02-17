# PRD — Deletion UX Improvement

- Slug: `deletion-ux-improvement`
- Date: `2026-02-12`
- Status: Draft

## Summary

Standardize deletion handling across all Alga PSA feature packages. Replace the current inconsistent mix of silent failures, generic error messages, and missing alternative actions with a unified system that validates dependencies, shows clear blocking reasons, offers alternatives (inactive/archive), and runs validation + deletion atomically in a single transaction.

## Problem

Deleting items in Alga PSA is currently inconsistent and confusing:

- **~40% of delete operations** fail silently with no indication of why
- **~60%** show only generic "Failed to delete" messages with no context
- **~80%** offer no alternative action when deletion is blocked
- **0%** show a dependency preview before the user attempts deletion
- **~10%** run validation and deletion in a single atomic transaction (rest have TOCTOU race conditions)
- **~30%** of tag-supporting entities are missing tag cleanup on deletion
- Only the `@alga-psa/clients` package has a good pattern (structured error responses, dependency counts, "Mark as Inactive" alternative)

Users get stuck, file support tickets, and lose trust in the product when they can't understand why something won't delete or what to do instead.

## Goals

1. **Consistent deletion UX** across all 20+ entity types with delete functionality
2. **Clear dependency feedback** showing exactly what blocks deletion (type, count, view link)
3. **Alternative actions** (deactivate, archive) offered when deletion is blocked
4. **Dependency preview** shown when the delete dialog opens, before the user confirms
5. **Atomic transactions** for validate-and-delete to prevent race conditions
6. **Automatic tag cleanup** for all taggable entities via centralized config
7. **Reusable infrastructure** (types, validation functions, dialog component, hook) so new entities get deletion UX for free

## Non-goals

- Changing what entities can/cannot be deleted (business rules stay the same)
- Adding soft-delete or trash/recycle-bin functionality
- Building a cascading delete system (entities with deps still require manual resolution)
- Retroactively adding archive/inactive support to entities that don't have it
- Monitoring, analytics, or audit logging for deletion operations

## Users and Primary Flows

**Primary user:** MSP admin managing clients, tickets, projects, billing, and configuration

**Flow 1 — Delete entity with no dependencies:**
1. User clicks Delete button on an entity
2. Dialog opens showing "Checking for dependencies..." spinner
3. Preview completes: "Are you sure you want to delete X? This action cannot be undone."
4. User clicks Delete
5. Atomic validate + delete executes in one transaction
6. Entity deleted, tags cleaned up, user redirected

**Flow 2 — Delete entity with dependencies (alternative available):**
1. User clicks Delete button
2. Dialog opens, preview runs
3. Dialog shows "Cannot Delete X" with itemized dependency list (e.g., "5 tickets, 2 projects")
4. Dialog shows "Alternative Options" section with "Mark as Inactive" button
5. User clicks "Mark as Inactive" (or closes dialog to manually resolve deps)

**Flow 3 — Delete entity with dependencies (no alternative):**
1. User clicks Delete button
2. Dialog opens, preview runs
3. Dialog shows dependency list and message: "Please remove or reassign these items before deleting."
4. User closes dialog, resolves dependencies, retries

## UX / UI Notes

**New component:** `DeleteEntityDialog` in `@alga-psa/ui`
- Three states: validating (spinner), can-delete (confirmation), cannot-delete (dependency list + alternatives)
- Dependency list shows count + optional "View" link per dependency type
- Alternative actions shown as primary button(s) when deletion is blocked
- Loading states on all buttons during async operations
- Separate from existing `ConfirmationDialog` (which remains for non-deletion confirmations)

**Existing `ConfirmationDialog`** is NOT modified — it continues to serve general-purpose confirmations (unsaved changes, recurring event scope, etc.)

## Requirements

### Functional Requirements

**FR-1: Shared deletion types** (`@alga-psa/types`)
- `DeletionValidationResult` with `canDelete`, `code`, `message`, `dependencies[]`, `alternatives[]`
- `DeletionDependency` with `type`, `count`, `label`, `viewUrl`
- `DeletionAlternative` with `action`, `label`, `description`, `warning`
- `EntityDeletionConfig` with dependency definitions, tag support, and alternative support flags
- `EntityDependencyConfig` with `table`, `foreignKey`, `countQuery`, `viewUrlTemplate`

**FR-2: Deletion validation functions** (`@alga-psa/core`)
- `validateDeletion(trx, config, entityId, tenant)` — counts dependencies within a transaction
- Plain functions (not a class), matching codebase conventions

**FR-3: Entity deletion configs** (`@alga-psa/core`)
- Schema-verified configs for all 20+ entity types
- Foreign keys validated against live PostgreSQL schema
- `tagEntityType` field for automatic tag cleanup

**FR-4: Server action helpers** (`@alga-psa/core`)
- `preCheckDeletion(entityType, entityId)` — read-only preview for dialog opening
- `deleteEntityWithValidation(entityType, entityId, performDelete)` — atomic validate + tag cleanup + delete in one `withTransaction`

**FR-5: Delete dialog component** (`@alga-psa/ui`)
- `DeleteEntityDialog` with validation result display, dependency list, alternative actions, loading states

**FR-6: Dependency preview hook** (`@alga-psa/core`)
- `useDeletionValidation(entityType)` — manages validation state for UI components

**FR-7: Bulk deletion validation** (`@alga-psa/core`)
- `validateBulkDeletion(entityType, entityIds)` — single-transaction validation for multiple entities

**FR-8: Client deletion migration** (`@alga-psa/clients`)
- Refactor `deleteClient` to use `deleteEntityWithValidation`
- Replace `ConfirmationDialog` with `DeleteEntityDialog` in `ClientDetails.tsx`
- Wire `onAlternativeAction` to existing `markClientInactiveWithContacts`

**FR-9: Feature package migrations** (all remaining packages)
- Each package: add validate action, refactor delete action, switch to `DeleteEntityDialog`
- Remove manual `deleteEntityTags` calls (automatic via config)

### Non-functional Requirements

- All deletion configs must use schema-verified foreign key names
- Validation and deletion must share a single database transaction
- Tag cleanup must be automatic for all entities with `tagEntityType` set
- Bulk validation must use a single transaction (not N parallel transactions)

## Data / API / Integrations

**Database tables involved** (verified against schema):
- All entity tables (tickets, contacts, projects, invoices, assets, interactions, etc.)
- Join/association tables (team_members, schedule_entry_assignees, contract_line_services, etc.)
- Tag tables (tag_definitions, tag_mappings) via `@alga-psa/tags` cleanup utilities
- Document associations (document_associations with entity_type polymorphism)

**Key schema corrections from v1 plan:**
- `company_id` → `client_id` (contacts, tickets, projects, invoices, assets, interactions)
- `user_team_members` → `team_members`
- `company_billing_plans` → does not exist; use `contract_line_services`
- `schedule_entries.user_id` → `schedule_entry_assignees.user_id` (M2M)
- `invoices.tax_rate_id` → does not exist; use `client_tax_rates`

## Security / Permissions

- `preCheckDeletion` and `deleteEntityWithValidation` both check `getCurrentUser()` and `hasPermission(user, entity, 'delete')`
- Permission entity mapping: `client` → `company` (existing convention)
- No new permissions introduced; existing RBAC delete permissions are reused

## Rollout / Migration

**Phase 1 (Week 1-2):** Core infrastructure — types, validation functions, configs, dialog, hook
**Phase 2 (Week 3-4):** P0 migrations — clients, users, teams
**Phase 3 (Week 5-6):** P1 migrations — billing (contracts, services, products)
**Phase 4 (Week 7-8):** P2 migrations — tickets, projects, reference-data
**Phase 5 (Week 9-10):** P3 migrations — surveys, scheduling, tax rates, bulk validation

Each package migration is independently deployable. No database migrations required.

## Open Questions

1. Should the `DeleteEntityDialog` support dark mode from the start? (The app is adding dark mode support on the `dark_times` branch.)
2. For entities with `supportsCascade: true` (tickets, projects), should the dialog explain what will be cascade-deleted?
3. Should bulk delete in `TicketingDashboard` use the new `validateBulkDeletion` immediately, or is that a P3 enhancement?

## Acceptance Criteria (Definition of Done)

1. All 20+ entity types use `DeleteEntityDialog` for deletion confirmation
2. All delete actions use `deleteEntityWithValidation` for atomic transactions
3. All entity configs have schema-verified foreign keys
4. All taggable entities have automatic tag cleanup via `tagEntityType`
5. Dependency preview loads when the delete dialog opens (before user confirms)
6. Blocked deletions show itemized dependency list with counts
7. Entities with `supportsInactive`/`supportsArchive` offer alternative actions in the dialog
8. No manual `deleteEntityTags` calls remain in migrated packages
9. Existing `ConfirmationDialog` is unchanged and continues to work for non-deletion use cases
10. No regressions in existing deletion functionality
