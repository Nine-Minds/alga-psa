# Scratchpad — Service requests: delete forms that were never submitted

- Plan slug: `service-request-delete-unused-forms`
- Created: `2026-11-10`
- Source: AlgaPSA ticket alga-2026-0002989

## Decisions

- **Use the platform deletion engine, not a bespoke submissions check.** A general mechanism already exists and every sibling delete flow uses it:
  - `DELETION_CONFIGS` (`packages/core/src/config/deletion/index.ts`) declares the dependencies.
  - `validateDeletion` and `deleteEntityWithValidation` (`packages/core/src/server/deletion/`) run the check and the delete in one transaction.
  - `preCheckDeletion` (`packages/auth/src/lib/preCheckDeletion.ts`) does the permission check plus the pre-check.
  - The `useDeletionValidation` hook and `DeleteEntityDialog` (`packages/ui/src/components/DeleteEntityDialog.tsx`) show the dependency list and offer alternatives such as `archive`.

  The reference sibling is the service catalog: `packages/billing/src/actions/serviceActions.ts` ~863 and `ServiceCatalogManager.tsx` ~510/1650.
- **The Delete menu item is always shown; the dialog explains blocks.** Hiding or disabling it per row would mean the list query re-deriving "what blocks deletion". That logic covers submissions *and* checklist rules, and it would drift from the engine. The dialog already disables Delete and shows the counts plus an Archive alternative. Decided to keep one source of truth.
- **Checklist apply rules block** (they do not silently dangle). This matches board deletion (`countBoardChecklistApplyRules`, which is blocking). `blocking: false` is reserved for links the delete cleans up itself, and we do not rewrite predicates.
- **Saved list views are not counted.** No deletable entity counts list-view predicate references today (boards don't). A dangling ID in a view filter just stops matching.
- **Strip the `archive` alternative client-side for already-archived rows.** The config is static (`supportsArchive: true`), so the engine always offers it.
- **FK race handling (F007)** is implemented but has no dedicated test (80/20). RESTRICT already prevents data loss; the only failure mode is an ugly error message.
- **One small shared component** for the dialog wiring, used by the list page and the editor (two call sites). It lives in `server/src/app/msp/service-requests/`.

## Discoveries / Constraints (verified on origin/main 88c634d5b5)

- Row menu: `ServiceRequestsManagementPage.tsx` ~155-220 has Duplicate plus Archive/Unarchive only. Confirmed. The editor (`ServiceRequestDefinitionEditorPage.tsx` ~1203-1263) has only Save Draft and Publish buttons in its header, so no delete.
- Locale `server/public/locales/en/msp/service-requests.json` lines 18-22: `management.actions.{duplicate,archive,unarchive}`. Confirmed. Locales present: de en es fr it nl pl pt sv + xx yy pseudo.
- `archiveServiceRequestDefinitionAction` (`actions.ts` ~625-638) requires `delete` and archives through `archiveServiceRequestDefinitionFromManagement` → `definitionLifecycle.archiveServiceRequestDefinition`. Confirmed.
- **Differs from the brief:** the permission resource is `service`, not a service-request-specific resource. `requireServiceRequestPermission` calls `hasPermission(user, 'service', action)` and rejects `user_type === 'client'`. So "service request delete permission" is literally `service:delete`, the same resource the service catalog uses. `preCheckDeletion.permissionEntityFor` therefore needs an explicit `service_request_definition → service` mapping, otherwise it checks a nonexistent `service_request_definition` resource and denies everyone. The interaction_type comment there documents exactly that trap.
- `deleteServiceRequestDefinitionFromManagement` (`definitionManagement.ts` ~572-606): hard delete, no submissions check. Confirmed. It already:
  - clears audience tag references (`deleteTagReferences(trx, tenant, 'service_request_audience', id)`);
  - publishes `SERVICE_REQUEST_DEFINITION_DELETED`.

  Its only caller is `server/src/test/integration/serviceRequestAudienceScoping.integration.test.ts:272`, which ignores the return value.
- FKs (migration `20260329150000_create_service_request_domain_tables.cjs`). Confirmed:
  - versions → definitions: CASCADE (~97-101).
  - submissions → definitions and → versions: RESTRICT (~133-142).
  - attachments → submissions: CASCADE.
- `20260921100000_create_service_request_answer_mapping_tables.cjs`:
  - `service_request_answer_mappings` → definitions: CASCADE.
  - `…_answer_mapping_versions` → mappings: CASCADE. It also has a `definition_id` column, but no FK to definitions.
  - `…_submission_applications` → submissions: CASCADE.
  - applications → mapping versions: RESTRICT. Applications only exist for submissions, so they are irrelevant here.
- No other migration adds an FK to definitions or versions (`grep -rn "inTable('service_request_definition\|REFERENCES service_request_definition" server/migrations ee/server/migrations`).
- Audience and visibility live on the definition row itself (`audience` jsonb from `20261028090000…`, `visibility_config`). Tag links are in `tag_references`.
- Tickets: there is **no** `service_request_definition_id` column. In `shared/lib/ticketQuery/ticketQuerySchema.ts` ~74 the path is computed as a subquery on `service_request_submissions.created_ticket_id`. A never-submitted definition can't be referenced by tickets.
- Checklist apply rules: legacy column `service_request_definition_id` was folded into the `where` predicate (`20261028120000_checklist_rule_predicates.cjs`). The path is offered by `packages/tickets/src/lib/ticketPredicateFields.ts:64`. `predicateReferencesValue` handles scalar and array values.
- Search: `packages/search/src/indexers/service_request_definition.ts` subscribes to `…_DELETED`. The generic `searchIndexSubscriber` deletes the doc for delete events, and for any event whose `loadOne` returns null. Nothing extra is needed beyond publishing the event.
- Documents/attachments: nothing associates documents with definitions. There is no `document_associations` entity type for them; attachments hang off submissions.
- Starter templates: definitions are copied from provider templates, and no linkage row is persisted. Appliance-license flows don't reference definition IDs.
- `EntityDeletionConfig.tagEntityType` is declared but unused by the engine, so tag cleanup must stay explicit in `performDelete`.
- `deleteEntityWithValidation` doesn't detect "row missing": validation passes and the delete affects 0 rows. That is why the domain function pre-reads the row (it also needs `lifecycle_state` for the event payload).
- Imports available in `server/`: `deleteEntityWithValidation` from `@alga-psa/core/server` (used by `server/src/lib/api/services/*`), `preCheckDeletion` from `@alga-psa/auth/lib/preCheckDeletion`, `useDeletionValidation` from `@alga-psa/auth/hooks/useDeletionValidation`, `DeleteEntityDialog` from `@alga-psa/ui`.
- Generic config-shape sweeps already exist in `packages/core/src/server/deletion/deletionMigrations.test.ts`. No new config-shape test is needed.

## Unrelated finding (not in scope)

- The search indexer builds definition URLs as `/msp/service-requests/definitions/{id}`, but the route is `/msp/service-requests/[definitionId]`. Search hits for definitions likely 404. Worth a separate ticket.

## Commands / Runbooks

- Find references: `git grep -n "service_request_definition_id"`, `git grep -n "SERVICE_REQUEST_DEFINITION_DELETED"`
- Translations: `node scripts/generate-pseudo-locales.cjs` then `node scripts/validate-translations.cjs`
- Integration tests: `server/src/test/integration/serviceRequestDefinitionManagement.integration.test.ts` (uses `createTestDbConnection({ runSeeds: false })`)

## Links / References

- Engine: `packages/core/src/config/deletion/index.ts`, `packages/core/src/server/deletion/deletionActions.ts`, `deletionValidation.ts`
- UI: `packages/ui/src/components/DeleteEntityDialog.tsx`, `packages/auth/src/hooks/useDeletionValidation.ts`
- Feature: `server/src/app/msp/service-requests/{actions.ts,ServiceRequestsManagementPage.tsx,ServiceRequestDefinitionEditorPage.tsx}`, `server/src/lib/service-requests/definitionManagement.ts`

## Open Questions

- None.
