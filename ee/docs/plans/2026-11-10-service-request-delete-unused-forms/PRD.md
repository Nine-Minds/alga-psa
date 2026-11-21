# PRD — Service requests: delete forms that were never submitted

- Slug: `service-request-delete-unused-forms`
- Date: `2026-11-10`
- Status: Draft
- Source: AlgaPSA ticket alga-2026-0002989

## Summary

Let MSP users permanently delete a service request definition (form) that has never been submitted. Forms that have submissions keep today's archive-only behavior. The delete goes through the platform's existing deletion engine (`DELETION_CONFIGS` + `deleteEntityWithValidation` + `preCheckDeletion` + `DeleteEntityDialog`). It is not a bespoke check.

## Problem

Service request definitions can only be archived. While setting up their catalog, admins create trial forms that are never used. Those forms stay in the list forever (under "Show archived"), and anyone can unarchive one by mistake and republish it. A form that no client ever submitted has no history worth keeping, so it should be deletable.

There is already a hard-delete helper, `deleteServiceRequestDefinitionFromManagement`, but nothing in the product calls it. It does no dependency check either. On a form with submissions it would fail on the `service_request_submissions` FK (ON DELETE RESTRICT) and surface a raw database error.

## Goals

- An MSP user with `service:delete` can delete a definition that has no submissions, from the management list row menu and from the definition editor.
- A definition with submissions cannot be deleted. The user sees why (the submission count) and is offered Archive instead (unless the form is already archived).
- The submissions check and the delete run in one transaction. The FK RESTRICT is the backstop against a submission that arrives in between.
- Deleting removes the definition's versions, answer mappings, audience tag references and search index row. Nothing is left orphaned.

## Non-goals

- Deleting definitions that have submissions, or deleting submissions themselves.
- Bulk delete.
- Changing archive/unarchive behavior, or restricting unarchive.
- Cleaning up saved ticket list views that filter on a deleted definition. Dangling IDs in list-view predicates already happen for every other deletable entity (e.g. boards). They just stop matching.
- Fixing the search indexer's definition URL (see SCRATCHPAD, unrelated finding).

## Users and Primary Flows

Persona: an MSP admin who manages the service request catalog (`/msp/service-requests`).

1. **Delete an unused form from the list.** Row menu → Delete. The `DeleteEntityDialog` opens and runs `preCheckDeletion('service_request_definition', id)`. With no blocking dependencies it asks for confirmation. On confirm, the row disappears and a success toast shows.
2. **Try to delete a form with submissions.** Row menu → Delete. The dialog shows "Cannot Delete" with "N submissions" and an Archive button. Archive archives the form and closes the dialog. If the form is already archived, the dialog shows only the explanation and Cancel.
3. **Delete from the editor.** The editor header gets a Delete button (outline/destructive) next to Save Draft / Publish. It uses the same dialog. On success the user goes back to `/msp/service-requests`.
4. **Form is referenced by a checklist apply rule.** The dialog shows "N checklist apply rules" as blocking, the same way board deletion treats checklist rules. The user edits the rule first.

## UX / UI Notes

- Use the standard `DeleteEntityDialog` (`@alga-psa/ui`) driven by the `useDeletionValidation` hook (`@alga-psa/auth/hooks/useDeletionValidation`). Do not build a bespoke confirmation.
- Wrap the dialog wiring (validate on open, confirm → delete action, alternative `archive` → archive action, strip the archive alternative when the row is already archived) in one small component in the service-requests feature folder. The list page and the editor both use it.
- The Delete menu item is always present in the row menu, with a `Trash2` icon, placed after Archive/Unarchive. Whether the form can be deleted, and why not, is explained in the dialog by the deletion engine. The list does not compute it separately. This keeps one source of truth for "what blocks deletion" (submissions *and* checklist rules).
- Confirmation copy (custom `confirmationMessage`, translated): the form and all its versions will be permanently removed, and this cannot be undone.
- All new strings go in `server/public/locales/<locale>/msp/service-requests.json`: `management.actions.delete`, `editor.delete`, `deleteDialog.confirmation`, `messages.success.definitionDeleted`, `messages.error.deleteFailed`. Add them to every locale (en, de, es, fr, it, nl, pl, pt, sv) and regenerate the xx/yy pseudo-locales. Run `node scripts/validate-translations.cjs`.
- No raw IDs anywhere. The dialog shows the form name.

## Requirements

### Functional Requirements

1. **Deletion config.** Add a `service_request_definition` entry to `DELETION_CONFIGS` (`packages/core/src/config/deletion/index.ts`):
   - `supportsArchive: true`, `supportsInactive: false`.
   - Blocking dependency `submission`: table `service_request_submissions`, foreignKey `definition_id`, label `submission`.
   - Blocking dependency `checklist_apply_rule`: table `checklist_template_apply_rules`, `countQuery: countPredicateReferences('checklist_template_apply_rules', 'where', 'service_request_definition_id')`, label `checklist apply rule`. This mirrors `countBoardChecklistApplyRules`.
2. **Permission mapping.** In `preCheckDeletion`, `permissionEntityFor('service_request_definition')` returns `'service'`. This matches `requireServiceRequestPermission`, which gates every service-request action on the `service` resource.
3. **Domain delete.** Rewrite `deleteServiceRequestDefinitionFromManagement` (`server/src/lib/service-requests/definitionManagement.ts`) on top of `deleteEntityWithValidation('service_request_definition', …)`:
   - Look up the row (tenant-scoped). If it is missing, return `{ canDelete: false, code: 'NOT_FOUND', … }`.
   - `performDelete(trx)`: `deleteTagReferences(trx, tenant, 'service_request_audience', id)`, then a tenant-scoped delete of the definition. Versions and answer mappings cascade through their FKs.
   - If the delete hits FK violation `23503` (a submission landed between validation and delete), re-run validation and return the blocked result. Never surface the raw error.
   - On `deleted: true`, publish `SERVICE_REQUEST_DEFINITION_DELETED` (existing `publishServiceRequestDefinitionSearchEvent`). The generic search subscriber removes the `app_search_index` row.
   - Return `DeletionValidationResult & { deleted: boolean }`.
4. **Server action.** Add `deleteServiceRequestDefinitionAction(definitionId)` to `server/src/app/msp/service-requests/actions.ts`. It is gated on `requireServiceRequestPermission(user, 'delete')`, the same gate as archive, which also rejects client users. It delegates to the domain function.
5. **List row menu.** Add a Delete item that opens the shared delete dialog. On success it reloads the list and shows a toast. The Archive alternative calls `archiveServiceRequestDefinitionAction` and reloads.
6. **Editor.** Add a Delete button in the editor header that uses the same dialog. On success it calls `router.push('/msp/service-requests')`.

### Non-functional Requirements

- Every query is tenant-scoped (`tenantDb` / the engine's `tenant` predicate). Tables are Citus-distributed by tenant. No migration is needed.

## Data / API / Integrations

- No schema change. Existing FKs:
  - `service_request_definition_versions.definition_id` → definitions: ON DELETE CASCADE.
  - `service_request_submissions.definition_id` / `definition_version_id`: ON DELETE RESTRICT. This is the backstop.
  - `service_request_answer_mappings.definition_id` → definitions: CASCADE. `service_request_answer_mapping_versions` → mappings: CASCADE. `service_request_submission_applications` hang off submissions, so none exist without submissions.
  - Audience tags live in `tag_references` (referrer type `service_request_audience`). They are cleared explicitly in `performDelete`.
- Tickets have no `service_request_definition_id` column. The ticket-query path is computed through `service_request_submissions.created_ticket_id`, so no tickets can point at a definition that was never submitted.
- Event: `SERVICE_REQUEST_DEFINITION_DELETED` already exists in the event schema and the search indexer's `sourceEvents`.

## Security / Permissions

- The server action requires an MSP user with `service:delete`, the existing gate archive uses.
- The dialog pre-check maps the entity to `service:delete`, so users without it see a permission-denied explanation rather than a delete button that fails.

## Observability

None beyond existing event publishing.

## Rollout / Migration

No flag and no migration. The change is additive.

## Open Questions

None. Scope was decided upstream.

## Acceptance Criteria (Definition of Done)

- A never-submitted draft, published or archived definition can be deleted from the list and from the editor. Its versions, answer mapping and audience tag references are gone, and the delete event is published.
- A definition with at least one submission cannot be deleted. The dialog lists the submission count and offers Archive (not shown for an already-archived form). The definition and its versions are untouched.
- A definition referenced by a checklist apply rule's `where` predicate is blocked with the rule count.
- A user without `service:delete`, or a client user, cannot delete.
- New strings are translated in all locales and `validate-translations` passes.
