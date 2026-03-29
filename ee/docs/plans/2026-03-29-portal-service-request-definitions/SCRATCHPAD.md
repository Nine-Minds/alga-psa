# Scratchpad — Portal Service Request Definitions

- Plan slug: `portal-service-request-definitions`
- Created: `2026-03-29`

## What This Is

Working memory for the portal service request definitions effort. This is the place to capture architectural decisions, discovered seams in the repo, and practical implementation notes that should not get lost while the PRD and feature breakdown evolve.

## Decisions

- (2026-03-29) Product frame is `Request Services` in the client portal, not “workflow forms.” Workflow is the fulfillment engine, not the user-facing concept.
- (2026-03-29) Execution model is workflow-first architecturally, but CE must provide an easy `ticket-only` preset so the feature is useful without workflow authoring.
- (2026-03-29) Templates are only shortcuts. They instantiate normal editable service request definitions and carry no special runtime semantics.
- (2026-03-29) Definitions may be optionally linked to `service_catalog`, and that linkage should be first-class in the data model and admin UI.
- (2026-03-29) Do not use the invoice/quote visual designer as the primary form-authoring experience. Use a constrained schema-driven builder and existing dynamic form rendering instead.
- (2026-03-29) CE/EE split should be host-platform plus providers, not feature-flag conditionals scattered through the app. CE owns the host and built-in basic providers; EE registers advanced providers.
- (2026-03-29) New core domain should live outside `service_catalog`, `workflow_form_definitions`, and `workflow_tasks`. Those are integration targets, not the primary model.
- (2026-03-29) MVP review surfaces are limited to per-definition submission review for MSPs plus `My Requests` for portal users; no cross-definition submissions inbox in v1.
- (2026-03-29) File-upload fields will reuse the existing document/file storage model, with service-request attachment rows serving as linkage metadata.
- (2026-03-29) Publish validation will block missing linked-service references and warn, but not block, on inactive linked services.

## Discoveries / Constraints

- (2026-03-29) Existing workflow renderer is [DynamicForm.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/ee/packages/workflows/src/components/workflow/DynamicForm.tsx). It already supports JSON Schema/UI Schema rendering, conditional logic, template variables, and custom widgets. Reuse as rendering infrastructure, not as the product model.
- (2026-03-29) Existing workflow human-task stack is centered on `workflow_form_definitions`, `workflow_form_schemas`, `workflow_task_definitions`, `workflow_tasks`, and `workflow_task_history`. Those records are task/execution-oriented and wrong for a published client-facing service definition lifecycle.
- (2026-03-29) Client portal navigation is hardcoded in [ClientPortalLayout.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/components/layout/ClientPortalLayout.tsx). `Request Services` fits naturally as another first-class nav item.
- (2026-03-29) Appointment requests are the strongest local precedent for a non-ticket portal request with its own lifecycle and request-history UX:
  - server actions: [appointmentRequestActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts)
  - page/component: [AppointmentsPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/components/appointments/AppointmentsPage.tsx)
- (2026-03-29) Existing client portal ticket flow is the best reuse point for the CE easy path:
  - action surface: [client-tickets.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/actions/client-portal-actions/client-tickets.ts)
  - UI: [ClientAddTicket.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/components/tickets/ClientAddTicket.tsx)
- (2026-03-29) Existing authenticated-client helper in [clientAuth.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/lib/clientAuth.ts) is the likely seam for submission ownership, visibility enforcement, and request history scoping.
- (2026-03-29) `service_catalog` is heavily billing-coupled through contracts, usage, invoice generation, accounting, and portal billing screens. Reuse it only as optional linkage/taxonomy, not as the request-definition host.
- (2026-03-29) Existing CE/EE split patterns worth copying:
  - top-level feature selection in [features.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/features.ts)
  - guarded CE entrypoints delegating to EE implementations for specific surfaces, e.g. [install route](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/api/v1/extensions/install/route.ts)
  - entrypoint indirection in `packages/client-portal/src/domain-settings/*`
  - enterprise capability registries in [providers.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/ee/server/src/lib/extensions/providers.ts) and [gateway-registry.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/ee/server/src/lib/extensions/lib/gateway-registry.ts)

## Commands / Runbooks

- (2026-03-29) Search for workflow-form/task seams:
  - `rg -n "user form|workflow form|human task|workflow_form_definitions|workflow_tasks" server packages ee docs .`
- (2026-03-29) Search for client portal seams:
  - `rg -n "client-portal|client portal|appointmentRequestActions|client-tickets" server/src/app packages/client-portal ee/server/src`
- (2026-03-29) Search for service catalog usage:
  - `rg -n "service_catalog|service_types|service_categories" server packages ee docs .`
- (2026-03-29) Scaffolded this plan folder with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Portal Service Request Definitions" --slug portal-service-request-definitions`

## Links / References

- Workflow form registry docs: [form-registry.md](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/docs/workflow/form-registry.md)
- Workflow inline forms docs: [inline-form-example.md](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/docs/workflow/inline-form-example.md)
- Task inbox docs: [task-inbox-integration.md](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/docs/workflow/task-inbox-integration.md)
- Billing/service catalog framing: [billing_for_msps_with_alga_psa.md](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/docs/billing/billing_for_msps_with_alga_psa.md)
- Client portal layout: [ClientPortalLayout.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/components/layout/ClientPortalLayout.tsx)
- Appointment request precedent: [appointmentRequestActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts)
- Ticket easy-path precedent: [client-tickets.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/actions/client-portal-actions/client-tickets.ts)

## Open Questions

- None currently blocking implementation.
- (2026-03-29) Added CE host feature slice at [server/src/lib/service-requests/index.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/index.ts) with domain contracts in [domain.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/domain.ts) and provider contracts in [contracts.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/providers/contracts.ts).
- (2026-03-29) Implemented registry-by-key provider resolution in [registry.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/providers/registry.ts) with CE built-ins for `ticket-only`, `basic`, `all-authenticated-client-users`, and `ce-starter-pack` template registration.
- (2026-03-29) Added single EE provider entrypoint seam via [enterpriseEntry.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/providers/enterpriseEntry.ts), [registerEnterpriseProviders.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/providers/registerEnterpriseProviders.ts), and startup integration in [initializeApp.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/initializeApp.ts).
- (2026-03-29) Added CE/EE module pair for enterprise provider registration loading:
  - CE stub: [packages/ee/src/lib/service-requests/providers.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/ee/src/lib/service-requests/providers.ts)
  - EE implementation: [ee/server/src/lib/service-requests/providers.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/ee/server/src/lib/service-requests/providers.ts)
- (2026-03-29) Added test coverage for CE provider boot behavior in [providerRegistry.unit.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/unit/service-requests/providerRegistry.unit.test.ts) (maps to T004).

## Commands / Runbooks (continued)

- (2026-03-29) Run targeted service-request provider registry unit tests:
  - `cd server && npx vitest run src/test/unit/service-requests/providerRegistry.unit.test.ts`
- (2026-03-29) Added migration [20260329150000_create_service_request_domain_tables.cjs](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/migrations/20260329150000_create_service_request_domain_tables.cjs) to create:
  - `service_request_definitions`
  - `service_request_definition_versions`
  - `service_request_submissions`
  - `service_request_submission_attachments`
- (2026-03-29) Definitions/submissions schema follows existing tenant-composite key pattern (`tenant` + entity id) and includes provider-key/config columns to preserve CE/EE extensibility without EE-specific table forks.
- (2026-03-29) Added DB-backed integration test [serviceRequestDomainTables.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestDomainTables.integration.test.ts) covering draft insert, published v1 insert, durable submission insert, and tenant-scoped reads (T001).

## Commands / Runbooks (continued)

- (2026-03-29) Run service request domain table integration test:
  - `cd server && npx vitest run src/test/integration/serviceRequestDomainTables.integration.test.ts`
- (2026-03-29) Added publish helper [definitionPublishing.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionPublishing.ts) that snapshots draft definition metadata/form/provider config into immutable `service_request_definition_versions` rows and increments `version_number` per definition.
- (2026-03-29) Added DB-backed integration test [serviceRequestPublishing.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestPublishing.integration.test.ts) validating immutable v1 snapshots after draft edits and republish to v2 (T002).

## Commands / Runbooks (continued)

- (2026-03-29) Run service request publish/versioning integration test:
  - `cd server && npx vitest run src/test/integration/serviceRequestPublishing.integration.test.ts`
- (2026-03-29) Added lifecycle helpers in [definitionLifecycle.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionLifecycle.ts):
  - archive definition (`lifecycle_state = archived`)
  - unarchive to draft
  - list published definitions only (portal discovery seam)
  - create mutable draft from latest published version snapshot
- (2026-03-29) Added integration coverage in [serviceRequestLifecycle.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestLifecycle.integration.test.ts) for archive preservation/discovery filtering (T003) and draft-from-published republish preserving prior version rows (T046).

## Commands / Runbooks (continued)

- (2026-03-29) Run service request lifecycle integration tests:
  - `cd server && npx vitest run src/test/integration/serviceRequestLifecycle.integration.test.ts`
- (2026-03-29) Added EE registry test [enterpriseProviderRegistrations.unit.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/unit/service-requests/enterpriseProviderRegistrations.unit.test.ts) validating enterprise provider pack includes workflow execution and advanced behavior registrations (T005).

## Commands / Runbooks (continued)

- (2026-03-29) Run enterprise provider registration unit test:
  - `cd server && npx vitest run src/test/unit/service-requests/enterpriseProviderRegistrations.unit.test.ts`
- (2026-03-29) Implemented historical-readability snapshots for linked taxonomy/service display names in [20260329150000_create_service_request_domain_tables.cjs](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/migrations/20260329150000_create_service_request_domain_tables.cjs):
  - `service_request_definitions.category_name_snapshot`
  - `service_request_definitions.linked_service_name_snapshot`
  - `service_request_definition_versions.category_name_snapshot`
  - `service_request_definition_versions.linked_service_name_snapshot`
- (2026-03-29) Updated publish-time snapshotting in [definitionPublishing.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionPublishing.ts) to resolve `service_categories.category_name` and `service_catalog.service_name` and persist those immutable display names on the published version.
- (2026-03-29) Added history-detail read seam [submissionHistory.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/submissionHistory.ts) and exported it via [index.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/index.ts) so submission rendering can use version snapshots rather than live catalog/category joins.
- (2026-03-29) Added DB-backed integrity test [serviceRequestHistoryIntegrity.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestHistoryIntegrity.integration.test.ts) validating `T044` / `F040`: renaming linked service/category after submission does not change historical rendered values.

## Commands / Runbooks (continued)

- (2026-03-29) Run history-integrity integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestHistoryIntegrity.integration.test.ts`
- (2026-03-29) Notes:
  - Avoid parallel execution of service-request integration tests in this repo because shared DB bootstrap (`test_database`) can conflict.
  - Ensure `server/coverage/.tmp` exists before `vitest run` in this environment to avoid coverage temp-file ENOENT failures.
- (2026-03-29) Added admin definition-management service helpers in [definitionManagement.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionManagement.ts) for:
  - list definitions across draft/published/archived lifecycle states
  - create blank draft definitions
  - instantiate draft definitions from registered template providers
  - duplicate an existing definition into a new draft copy
  - archive/unarchive from management workflows
- (2026-03-29) Added MSP admin management surface at [msp/service-requests/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/page.tsx) with interactive list UI in [ServiceRequestsManagementPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestsManagementPage.tsx) and server actions in [actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/actions.ts).
- (2026-03-29) Added sidebar navigation entry in [menuConfig.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/config/menuConfig.ts) for `/msp/service-requests` (`Service Requests`) to satisfy admin discoverability.
- (2026-03-29) Added integration test [serviceRequestDefinitionManagement.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestDefinitionManagement.integration.test.ts) validating T006 create blank/from-template, duplicate, archive, and unarchive flows end-to-end against the DB.

## Commands / Runbooks (continued)

- (2026-03-29) Run service request definition-management + history-integrity integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestDefinitionManagement.integration.test.ts src/test/integration/serviceRequestHistoryIntegrity.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Added editor data helper [definitionEditor.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionEditor.ts) that assembles section-ready data for basics/linkage/form/execution/publish and includes latest published-version metadata for draft-vs-published comparisons.
- (2026-03-29) Added definition editor route [msp/service-requests/[definitionId]/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/[definitionId]/page.tsx) and UI [ServiceRequestDefinitionEditorPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx) with explicit Basics, Linkage, Form, Execution, and Publish sections.
- (2026-03-29) Updated management list names in [ServiceRequestsManagementPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestsManagementPage.tsx) to link into the new editor route.
- (2026-03-29) Added integration coverage [serviceRequestDefinitionEditor.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestDefinitionEditor.integration.test.ts) for T007 editor section payload + published-context behavior.

## Commands / Runbooks (continued)

- (2026-03-29) Run definition editor integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestDefinitionEditor.integration.test.ts`
- (2026-03-29) Run definition management integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestDefinitionManagement.integration.test.ts`
- (2026-03-29) Added publish-validation host seam [definitionValidation.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionValidation.ts) with CE checks for:
  - required definition name
  - registered execution/form-behavior/visibility provider keys
  - provider config validation via provider contracts
  - linked-service existence (block when missing, warn when inactive)
- (2026-03-29) Added guarded publish path [publishServiceRequestDefinitionWithValidation](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionValidation.ts) and exposed action hooks in [msp/service-requests/actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/actions.ts).
- (2026-03-29) Added draft-save helper [saveServiceRequestDefinitionDraft](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionManagement.ts) and wired `Save Draft` / `Publish` controls plus validation feedback in [ServiceRequestDefinitionEditorPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx).
- (2026-03-29) Added integration coverage [serviceRequestDraftPublishValidation.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestDraftPublishValidation.integration.test.ts) for T008: incomplete draft save succeeds while publish fails with validation errors.

## Commands / Runbooks (continued)

- (2026-03-29) Run draft-save/publish-validation integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestDraftPublishValidation.integration.test.ts`
- (2026-03-29) Added pre-publish preview UX in [ServiceRequestDefinitionEditorPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx):
  - `Service Card Preview` section for portal-facing card metadata (F053)
  - `Rendered Form Preview` section for schema field presentation before publish (F054)
- (2026-03-29) Updated built-in template defaults in [starterTemplateProvider.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/providers/builtins/starterTemplateProvider.ts) to prefill ticket-mapping style execution config defaults.
- (2026-03-29) Added integration test [serviceRequestTemplateInstantiation.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestTemplateInstantiation.integration.test.ts) verifying template-instantiated drafts are detached/editable and that template usage remains an optional shortcut path (blank create still works).

## Commands / Runbooks (continued)

- (2026-03-29) Run template-instantiation integrity integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestTemplateInstantiation.integration.test.ts`
- (2026-03-29) Added linked-service picker backend helpers in [definitionManagement.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionManagement.ts):
  - `searchServiceCatalogForLinking(...)`
  - `setLinkedServiceForServiceRequestDefinitionDraft(...)`
- (2026-03-29) Added linkage picker actions in [msp/service-requests/actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/actions.ts) and linked-service search/select/clear UX in [ServiceRequestDefinitionEditorPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx).
- (2026-03-29) Added integration coverage [serviceRequestLinkedServicePicker.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestLinkedServicePicker.integration.test.ts) for T010 linked-service search and selection behavior.

## Commands / Runbooks (continued)

- (2026-03-29) Run linked-service picker integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestLinkedServicePicker.integration.test.ts`
- (2026-03-29) Added linked-service publish validation integration coverage in [serviceRequestLinkedServicePublishValidation.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestLinkedServicePublishValidation.integration.test.ts) for T011/F104/F107:
  - publish succeeds when `linked_service_id` is `null`
  - publish fails with `Linked service no longer exists` when a stale linked-service reference is present
  - Note: stale-reference scenario is simulated by dropping the FK in the isolated integration test DB and updating the row to an invalid id.
- (2026-03-29) Added admin submission review helpers in [submissionHistory.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/submissionHistory.ts):
  - `listServiceRequestSubmissionsForDefinition(...)`
  - `getServiceRequestSubmissionDetailForDefinition(...)`
- (2026-03-29) Added MSP editor action surface for definition-scoped submissions in [actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/actions.ts) and wired UI in [ServiceRequestDefinitionEditorPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx):
  - Submissions list by definition
  - Submission detail panel with requester/client/contact identity ids, submitted payload, and downstream ticket/workflow references
- (2026-03-29) Added integration coverage [serviceRequestAdminSubmissions.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestAdminSubmissions.integration.test.ts) for T030/F059/F060 definition-scoped submission list/detail behavior and downstream-reference rendering seams.

## Commands / Runbooks (continued)

- (2026-03-29) Run linked-service publish validation + admin submissions integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestLinkedServicePublishValidation.integration.test.ts src/test/integration/serviceRequestAdminSubmissions.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Added CE basic form-builder host module [basicFormBuilder.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/basicFormBuilder.ts) covering:
  - supported field types: `short-text`, `long-text`, `select`, `checkbox`, `date`, `file-upload`
  - field configuration shape: key, label, help text, required flag, static default value, and select option lists
  - draft authoring operations: add, update, remove, reorder, and replace schema
  - stable key generation for newly-added fields and key preservation across reorder/presentation edits
- (2026-03-29) Integrated basic form schema validation into publish validation in [definitionValidation.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionValidation.ts), including duplicate/invalid key detection and type-specific default/option validation.
- (2026-03-29) Exported basic form builder APIs through [service-requests/index.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/index.ts) for CE host usage.
- (2026-03-29) Added integration suite [serviceRequestBasicFormBuilder.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestBasicFormBuilder.integration.test.ts) covering:
  - T012: short/long/checkbox/date authoring + draft serialization
  - T013: select options/default preservation through publish snapshot
  - T014: add/remove/reorder + stable key behavior under presentation-only updates
  - T015: publish validation rejection for duplicate/invalid field keys

## Commands / Runbooks (continued)

- (2026-03-29) Run basic form builder integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestBasicFormBuilder.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Added client-portal top-level navigation item in [ClientPortalLayout.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/components/layout/ClientPortalLayout.tsx):
  - link target: `/client-portal/request-services`
  - label key: `nav.requestServices` with fallback `Request Services`
- (2026-03-29) Added route scaffold [server/src/app/client-portal/request-services/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/page.tsx) so the new nav destination is functional during incremental rollout.
- (2026-03-29) Added contract test [ClientPortalLayout.requestServicesNav.contract.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/packages/client-portal/src/components/layout/ClientPortalLayout.requestServicesNav.contract.test.ts) for T016.

## Commands / Runbooks (continued)

- (2026-03-29) Run Request Services nav contract test:
  - `cd packages/client-portal && npx vitest run src/components/layout/ClientPortalLayout.requestServicesNav.contract.test.ts`
- (2026-03-29) Added portal catalog host helper [portalCatalog.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/portalCatalog.ts):
  - lists only `published` definitions for a tenant
  - resolves visibility via provider registry (`visibility_provider` + `visibility_config`)
  - returns card metadata (icon/title/description) and groups cards by category (`Other Services` fallback)
- (2026-03-29) Added authenticated client-portal action [request-services/actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/actions.ts):
  - resolves authenticated client scope via `getAuthenticatedClientId`
  - returns grouped visible request-service catalog items for the current client user context
- (2026-03-29) Replaced request-services placeholder page with grouped card catalog rendering in [request-services/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/page.tsx).
- (2026-03-29) Added integration coverage [serviceRequestPortalCatalog.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestPortalCatalog.integration.test.ts) for T017/F080/F081/F082, including provider-driven visibility filtering and category grouping.

## Commands / Runbooks (continued)

- (2026-03-29) Run portal request-services catalog integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestPortalCatalog.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Added portal detail helper [portalDetail.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/portalDetail.ts) to resolve visible, published definition details from immutable version snapshots (`service_request_definition_versions`) rather than mutable draft schema.
- (2026-03-29) Added authenticated detail action [request-services/[definitionId]/actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/[definitionId]/actions.ts) with client-scope resolution and visibility enforcement.
- (2026-03-29) Added portal detail page [request-services/[definitionId]/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/[definitionId]/page.tsx) and updated catalog cards in [request-services/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/page.tsx) to navigate into it.
- (2026-03-29) Added integration coverage [serviceRequestPortalDetail.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestPortalDetail.integration.test.ts) for T018/F083/F084: detail reads published version snapshot even when definition draft/form data diverges.

## Commands / Runbooks (continued)

- (2026-03-29) Run portal request-service detail integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestPortalDetail.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Added static-default resolver [resolveStaticDefaultValues](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/basicFormBuilder.ts) for supported field types (`short-text`, `long-text`, `select`, `checkbox`, `date`; excludes `file-upload`).
- (2026-03-29) Extended portal detail model in [portalDetail.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/portalDetail.ts) to include `initialValues` derived from published form snapshots.
- (2026-03-29) Updated [request-services/[definitionId]/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/[definitionId]/page.tsx) to render resolved initial values for first-form render context.
- (2026-03-29) Added integration coverage [serviceRequestPortalDetailDefaults.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestPortalDetailDefaults.integration.test.ts) for T019/F085.

## Commands / Runbooks (continued)

- (2026-03-29) Run portal detail defaults integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestPortalDetailDefaults.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Added portal submission host helper [submissionService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/submissionService.ts) to support file-upload submission payloads:
  - validates required fields against the immutable published schema snapshot
  - enforces required `file-upload` presence via attachment `fieldKey` matching
  - persists durable `service_request_submissions` rows in `pending` state before any downstream execution starts
  - persists `service_request_submission_attachments` linkage rows with file metadata (`file_id`, name/type/size)
- (2026-03-29) Exported submission APIs from [service-requests/index.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/index.ts) for client-portal submit wiring.
- (2026-03-29) Added integration coverage [serviceRequestSubmissionAttachments.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts) for T020/F086: required file-upload submissions persist both submission and attachment linkage records on success.

## Commands / Runbooks (continued)

- (2026-03-29) Run submission attachment integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Extended [serviceRequestSubmissionAttachments.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts) with T021/F087 coverage:
  - submit attempts missing required non-file fields fail against the published version snapshot
  - validation remains snapshot-driven even when mutable draft schema diverges from the published schema
  - failed validation does not persist a submission row

## Commands / Runbooks (continued)

- (2026-03-29) Run submission attachment + required-field validation integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Extended [serviceRequestSubmissionAttachments.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts) with T022/F088 authorization coverage:
  - registered a test-only deny-all visibility provider via the CE provider registry
  - verified direct submit attempts to a published-but-hidden definition are rejected (`Service request is not visible or not published`)
  - verified no submission row is persisted on unauthorized direct-submit attempts
  - used `try/finally` to reset provider registry state to CE built-ins after test execution

## Commands / Runbooks (continued)

- (2026-03-29) Run submission authorization integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Added submit action in [request-services/[definitionId]/actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/[definitionId]/actions.ts):
  - parses form payload from published schema fields
  - supports file-upload linkage via `{fieldKey}__fileId` input convention
  - persists submission via `submitPortalServiceRequest(...)`
  - redirects back with `?submitted=<submissionId>` on success or `?error=<message>` on failure
- (2026-03-29) Updated [request-services/[definitionId]/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/[definitionId]/page.tsx) to include:
  - schema-driven form inputs for CE field types
  - confirmation state rendering stable request ID from `searchParams.submitted`
  - error state rendering from `searchParams.error`
- (2026-03-29) Extended [serviceRequestSubmissionAttachments.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts) with T023/F089/F090 coverage for durable pending submission + stable request id return.

## Commands / Runbooks (continued)

- (2026-03-29) Run submission flow integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Extended client-submission history host in [submissionHistory.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/submissionHistory.ts):
  - `listClientServiceRequestSubmissions(...)` for client-scoped history list rows
  - `getClientServiceRequestSubmissionDetail(...)` for client-scoped detail with immutable `form_schema_snapshot`
- (2026-03-29) Added client-portal My Requests action surface [my-requests/actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/my-requests/actions.ts) using authenticated client resolution and client-scoped history helpers.
- (2026-03-29) Added My Requests pages:
  - list view: [my-requests/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/my-requests/page.tsx)
  - detail view: [my-requests/[submissionId]/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/my-requests/[submissionId]/page.tsx)
- (2026-03-29) Updated request-services catalog header in [request-services/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/page.tsx) with `My Requests` shortcut navigation.
- (2026-03-29) Added integration coverage [serviceRequestPortalHistory.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestPortalHistory.integration.test.ts) for T024/F091/F092/F093/F094/F096:
  - list endpoint returns only same-client submissions
  - detail endpoint returns submitted payload + field presentation snapshot for same-client submissions
  - detail lookup returns null for cross-client submissions

## Commands / Runbooks (continued)

- (2026-03-29) Run portal history integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestPortalHistory.integration.test.ts`
- (2026-03-29) Run submission flow/history integration tests together:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestPortalHistory.integration.test.ts src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Extended client submission detail with attachment references in [submissionHistory.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/submissionHistory.ts):
  - `getClientServiceRequestSubmissionDetail(...)` now loads `service_request_submission_attachments` rows ordered by `created_at`
  - includes attachment metadata (`submission_attachment_id`, `file_id`, `file_name`, `mime_type`, `file_size`, `created_at`) in the detail model
- (2026-03-29) Updated [my-requests/[submissionId]/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/my-requests/[submissionId]/page.tsx) to render an Attachments section in portal request detail.
- (2026-03-29) Extended [serviceRequestPortalHistory.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestPortalHistory.integration.test.ts) with T025/F095 coverage for attachment references in history detail.
- (2026-03-29) Gotcha: attachment PK column is `submission_attachment_id` (not `attachment_id`) in migration [20260329150000_create_service_request_domain_tables.cjs](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/migrations/20260329150000_create_service_request_domain_tables.cjs); detail query/select must use the exact column name.

## Commands / Runbooks (continued)

- (2026-03-29) Run portal history tests including attachment detail:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestPortalHistory.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`

## Commands / Runbooks (continued)

- (2026-03-29) Implemented ticket-backed execution inside CE `ticket-only` provider in [ticketOnlyExecutionProvider.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts):
  - resolves board/status/priority from execution config with CE fallbacks
  - maps request payload to ticket title + structured description text
  - creates tickets through shared [TicketModel](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/shared/models/ticketModel.ts) (`createTicketWithRetry`)
  - returns `createdTicketId` on success or failure summary on error
- (2026-03-29) Updated provider execution context contract in [contracts.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/providers/contracts.ts) to include `knex`, and wired it through [submissionService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/submissionService.ts).
- (2026-03-29) Gotcha: provider execution must use the caller-scoped knex handle rather than opening a fresh tenant connection; using `createTenantKnex` in this path caused integration execution failures in test/runtime contexts without request tenant context.
- (2026-03-29) Updated request detail and submit flow for ticket references:
  - [portalDetail.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/portalDetail.ts) now exposes execution provider/config from the published version
  - [submissionService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/submissionService.ts) now executes provider after durable insert and writes terminal status + downstream refs (`created_ticket_id`, `workflow_execution_id`) back to submission rows
  - [request-services/[definitionId]/actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/[definitionId]/actions.ts) now includes `ticketId` in success redirect params
  - [request-services/[definitionId]/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/[definitionId]/page.tsx) now renders linked ticket reference in confirmation state when present
- (2026-03-29) Added integration coverage [serviceRequestTicketExecution.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestTicketExecution.integration.test.ts) for:
  - T026/F098/F099/F100/F101: successful ticket-only execution with configured defaults + payload mapping + ticket linkage
  - T027/F102: failure state persists durable submission with `execution_status=failed` and error summary
  - T028/F103: submission detail exposes linked ticket reference after successful execution
  - T029/F104: linked service remains optional for publish/submit success in ticket-only path
- (2026-03-29) Run ticket execution + submission integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestTicketExecution.integration.test.ts src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`

## Commands / Runbooks (continued)

- (2026-03-29) Discovery: the MSP management/editor surfaces and many backend flows were already implemented in-tree but not reflected in `features.json` / `tests.json`.
- (2026-03-29) Validated stale checklist coverage with targeted integration tests:
  - `cd server && npx vitest run src/test/integration/serviceRequestDefinitionManagement.integration.test.ts`
  - `cd server && npx vitest run --maxWorkers=1 src/test/integration/serviceRequestDefinitionEditor.integration.test.ts src/test/integration/serviceRequestDraftPublishValidation.integration.test.ts src/test/integration/serviceRequestTemplateInstantiation.integration.test.ts src/test/integration/serviceRequestLinkedServicePicker.integration.test.ts src/test/integration/serviceRequestLinkedServicePublishValidation.integration.test.ts src/test/integration/serviceRequestBasicFormBuilder.integration.test.ts src/test/integration/serviceRequestAdminSubmissions.integration.test.ts src/test/integration/serviceRequestHistoryIntegrity.integration.test.ts src/test/integration/serviceRequestPortalDetail.integration.test.ts src/test/integration/serviceRequestPortalDetailDefaults.integration.test.ts`
  - `cd server && npx vitest run src/test/integration/serviceRequestPortalCatalog.integration.test.ts`
- (2026-03-29) Updated checklist artifacts to mark implemented items that are covered by existing code/tests for:
  - MSP definition management and editor sections (create/duplicate/archive/unarchive, basics/linkage/form/execution/publish)
  - publish validation and template-instantiation behavior
  - linked service picker/search and linked-service publish validation
  - CE basic form builder field types, defaults, key stability, and field-key validation
  - portal catalog/detail/default-value behavior and admin submission history/detail
  - historical rendering integrity from version snapshots after category/service renames (F040/T044)

## Commands / Runbooks (continued)

- (2026-03-29) Added editor-execution provider options sourced from registry in [definitionEditor.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/definitionEditor.ts):
  - `execution.availableExecutionProviders[]` now includes provider key/displayName/executionMode for CE and any registered EE providers.
- (2026-03-29) Added editor action [updateServiceRequestExecutionProviderAction](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/actions.ts) and wired selection UI in [ServiceRequestDefinitionEditorPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx) so admins can choose execution providers (including CE `ticket-only`) without EE dependencies.
- (2026-03-29) Added integration coverage [serviceRequestWorkflowProviderEditorOptions.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestWorkflowProviderEditorOptions.integration.test.ts) for T031:
  - registers EE provider pack directly in test
  - verifies editor option surface includes `workflow-only` and `ticket-plus-workflow` in addition to `ticket-only`
- (2026-03-29) Run workflow provider editor option tests:
  - `cd server && npx vitest run src/test/integration/serviceRequestWorkflowProviderEditorOptions.integration.test.ts`
  - `cd server && npx vitest run src/test/integration/serviceRequestDefinitionEditor.integration.test.ts src/test/integration/serviceRequestWorkflowProviderEditorOptions.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Extended MSP execution authoring actions in [actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/actions.ts) with `updateServiceRequestExecutionConfigAction(...)` so workflow-backed provider config can be saved on drafts as `execution_config` without CE/EE table branching.
- (2026-03-29) Updated execution section UX in [ServiceRequestDefinitionEditorPage.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx) to support workflow-backed provider configuration:
  - `workflowId` input (admin chooses workflow to run)
  - JSON `inputMapping` editor (maps payload/ticket fields into workflow inputs)
  - save action wiring with draft refresh and publish-validation refresh
- (2026-03-29) Added integration suite [serviceRequestWorkflowExecution.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestWorkflowExecution.integration.test.ts) covering:
  - T032 / F111 / F112 / F114: `workflow-only` execution succeeds when configured and writes workflow reference
  - T033 / F113: `ticket-plus-workflow` path writes ticket + workflow refs with ticket-linked workflow reference shape
  - T034 / F115: workflow startup failure preserves durable submission with failed execution state and error summary
  - T035 / F116: client/admin request-history detail surfaces workflow references for workflow-backed submissions

## Commands / Runbooks (continued)

- (2026-03-29) Run workflow execution integration coverage:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestWorkflowExecution.integration.test.ts src/test/integration/serviceRequestWorkflowProviderEditorOptions.integration.test.ts`
- (2026-03-29) Run targeted server TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Extended form-behavior provider contract in [contracts.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/providers/contracts.ts) with optional `resolveVisibleFieldKeys(...)` so advanced providers can drive conditional field visibility consistently for portal render and submit validation.
- (2026-03-29) Updated portal detail resolver in [portalDetail.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/portalDetail.ts) to:
  - resolve dynamic context-aware defaults via form-behavior providers (`resolveInitialValues`)
  - resolve provider-driven `visibleFieldKeys` for first render
  - return form-behavior provider metadata/config alongside execution metadata for downstream submit handling
- (2026-03-29) Updated submit validation flow in [submissionService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/lib/service-requests/submissionService.ts) to honor provider-resolved visibility keys so hidden required fields do not block submit.
- (2026-03-29) Updated portal detail UI in [request-services/[definitionId]/page.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/app/client-portal/request-services/[definitionId]/page.tsx) to render only `visibleFieldKeys` from the resolved definition detail.
- (2026-03-29) Expanded EE advanced form provider in [ee/server/src/lib/service-requests/providers.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/ee/server/src/lib/service-requests/providers.ts):
  - added conditional visibility rule model (`visibilityRules`) with operators (`equals`, `not-equals`, `is-true`, `is-false`, `has-value`, `is-empty`)
  - added config validation errors for malformed conditional-logic config (publish-time blocking via host validation)
  - added visibility evaluation + context-source support (`context.requesterUserId`, `context.clientId`, `context.contactId`, payload field refs)
  - retained/extended context-aware default templating via `contextDefaults`
- (2026-03-29) Added integration suite [serviceRequestAdvancedFormBehavior.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestAdvancedFormBehavior.integration.test.ts) covering:
  - T036 / F118: conditional show/hide affects portal visible fields
  - T037 / F118 / F120: hidden required fields do not block submit and invalid conditional config fails publish validation
  - T038 / F119: requester/client context defaults resolve into portal initial values

## Commands / Runbooks (continued)

- (2026-03-29) Run advanced form behavior + related portal/submission integration tests:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestAdvancedFormBehavior.integration.test.ts src/test/integration/serviceRequestPortalDetail.integration.test.ts src/test/integration/serviceRequestPortalDetailDefaults.integration.test.ts src/test/integration/serviceRequestSubmissionAttachments.integration.test.ts`
- (2026-03-29) Run targeted TypeScript compile validation:
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
  - `cd ee/server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-29) Upgraded EE advanced visibility provider behavior in [ee/server/src/lib/service-requests/providers.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/ee/server/src/lib/service-requests/providers.ts):
  - config validation for `allowAll`, `allowedClientIds`, and `allowedRequesterUserIds`
  - runtime access checks that deny catalog/detail/submit access when client/requester is not in allowed lists
- (2026-03-29) Added integration test [serviceRequestAdvancedVisibility.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/premade-form-for-services/server/src/test/integration/serviceRequestAdvancedVisibility.integration.test.ts) for T039:
  - restricted definitions are hidden from catalog for unauthorized clients
  - direct submit attempts by unauthorized clients are rejected and persist no submission rows

## Commands / Runbooks (continued)

- (2026-03-29) Run advanced visibility integration test:
  - `mkdir -p server/coverage/.tmp && cd server && npx vitest run src/test/integration/serviceRequestAdvancedVisibility.integration.test.ts`
