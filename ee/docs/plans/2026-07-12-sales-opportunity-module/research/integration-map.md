# Codebase integration map — sales opportunity module

> Research artifact, 2026-07-12. Maps every existing AlgaPSA surface the sales/opportunity module ties into. Produced by a codebase survey of this worktree (branched from main at fd29f40cfc).

## Headline findings

- **Quotes is a fully-built, mature module.** Complete DB schema, REST API, server actions, UI (list/detail/editor/approval dashboard/document templates), client-portal acceptance flow, conversion-to-contract/invoice, and an expiry job. Per `ee/docs/plans/2026-03-13-quoting-system/` it shipped Phases 1–6.
- **`quotes.opportunity_id` already exists** as a nullable, FK-less placeholder column, explicitly added in quoting Phase 6 "even before a dedicated CRM module is present" (`ee/docs/plans/2026-03-13-quoting-system/SCRATCHPAD.md:288`). Carried through create/edit/convert but points at nothing.
- **No opportunity/lead/pipeline/deal/prospect tables exist anywhere** (confirmed across `server/migrations` and `ee/server/migrations`).
- **A CRM lifecycle is anticipated but not implemented.** `client_type` is only `'company' | 'individual'`; the only status-ish field is boolean `is_inactive`. Yet the workflow event catalog already ships `CLIENT_STATUS_CHANGED` described as "Lifecycle status transition (prospect→active, etc)." Vocabulary exists; schema doesn't.
- **The workflow engine already has a CRM module** (`shared/workflow/runtime/actions/businessOperations/crm.ts`) importing quote operations, plus EE plans (`workflow-crm-actions`, `workflow-crm-followup-actions`) sketching `crm.create_quote`, `crm.convert_quote`, `crm.schedule_activity`, etc.

## 1. Quotes — mature, production module

Tables (migration `server/migrations/20260320100000_create_quotes_tables.cjs`):
- `quotes` — header: `quote_id`, `quote_number` (via `next_number` entity `QUOTE`, prefix `Q-`), `client_id`, `contact_id`, `title`, `quote_date`, `valid_until`, `status`, `version` + `parent_quote_id` (revision chain), `subtotal/discount_total/tax/total_amount` (BIGINT cents), `currency_code`, `converted_contract_id`, `converted_invoice_id`, lifecycle timestamps (`sent_at/viewed_at/accepted_at/accepted_by/rejected_at/cancelled_at/expired_at/converted_at/archived_at`), `is_template`, `template_id`, and **`opportunity_id`** (nullable, no FK).
- `quote_items` — line items (`service_id`, `service_item_kind` service|product, `billing_method` fixed|hourly|usage|per_unit, quantity/unit_price/total/tax, `is_optional`, `is_selected`, `is_recurring`, `is_discount`, `phase`, `location_id`, `cost`).
- `quote_activities` — per-quote audit feed (`activity_type`, `description`, `performed_by`, `metadata` jsonb).
- Template tables: `quote_document_templates`, `standard_quote_document_templates`, `quote_document_template_assignments` (AST-based PDF; migrations `20260320102000`–`104000`, `20260416120000`).
- Status CHECK expanded for approval flow (`20260320160000`): adds `pending_approval`, `approved`.

Statuses (`packages/types/src/interfaces/quote.interfaces.ts:6`): `draft | pending_approval | approved | sent | accepted | rejected | expired | converted | cancelled | superseded | archived`. `opportunity_id?: string | null` at line 104.

Code locations:
- Actions/UI: `packages/billing/src/actions/quoteActions.ts` (opportunity_id at lines 994, 1093), `packages/billing/src/schemas/quoteSchemas.ts` (line 29), components in `packages/billing/src/components/billing-dashboard/quotes/` (QuoteForm, QuoteDetail, QuoteLineItemsEditor, QuoteConversionDialog, QuoteApprovalDashboard, QuotesTab, QuoteDocumentTemplateEditor, QuotePreviewPanel).
- AST templating: `packages/billing/src/lib/quote-template-ast/`.
- REST API: `server/src/app/api/v1/quotes/**` (`/convert`, `/convert/preview`, `/approve`, `/submit-for-approval`, `/request-changes`, `/revisions`, `/send`, `/resend`, `/remind`, `/activities`, `/items`). Controller `server/src/lib/api/controllers/ApiQuoteController.ts`, service `server/src/lib/api/services/QuoteService.ts`, schemas `server/src/lib/api/schemas/quoteSchemas.ts` (opportunity_id line 79), OpenAPI `server/src/lib/api/openapi/routes/quotesContractsV1.ts`.
- MSP pages: `server/src/app/msp/quote-approvals/`, `server/src/app/msp/quote-document-templates/` (Quotes surfaces as a tab inside Billing, not top-level nav).
- Client portal: `server/src/app/client-portal/billing/quotes/[quoteId]/page.tsx`.
- Expiry job: `server/src/lib/jobs/handlers/expireQuotesHandler.ts`.
- RBAC: resource `quotes`, action `approve` (`server/migrations/20260320105000_add_quote_approval_permission.cjs`).
- User doc: `docs/billing/quoting-system.md` (documents `opportunity_id` as "Optional CRM link").

Integration hooks: `opportunity_id` is the ready-made join point — give it a real `opportunities` table + FK. Quote→contract/invoice conversion exists (`convertQuoteToDraftContract` / `...AndInvoice` / `...DraftInvoice`). Quote lifecycle timestamps + `quote_activities` are a template for an opportunity activity feed.

## 2. Clients & contacts

- Main table `clients` (renamed from `companies`, `20251003000001_company_to_client_migration.cjs:47`; PK `(tenant, client_id)`). Contacts: `contacts` (PK `(tenant, contact_name_id)`).
- Lifecycle gap: `client_type` only `'company' | 'individual'` (`20260616120000_normalize_client_type_to_enum.cjs`; enum `packages/clients/src/schemas/client.schema.ts:69`). `is_inactive` boolean only (`202409111020`). `account_manager_id` FK→users exists (`20250411000000`) — ownership concept present. `ClientPropertiesSchema` (JSON `properties`) carries loose `status`, `industry`, `company_size`, `annual_revenue`, `last_contact_date`, `parent_client_id` (`packages/clients/src/schemas/client.schema.ts:12`) — no structured prospect state.
- CRM-center package = `packages/clients/`: models (`client.ts`, `interactions.ts`, `clientContract.ts`, `onlineMeeting.ts`), actions (`clientActions.ts`, `interactionActions.ts`, `interactionTypeActions.ts`, `interactionCreateHelper.ts`, `clientTimelineActions.ts`, `clientPulseActions.ts` — client-health concept, `clientNoteActions.ts`, `clientContractActions.ts`, `entraClientSyncActions.ts`), `lib/commandCenterTypes.ts`, `lib/clientContractWorkflowEvents.ts`.
- Interactions module (working lightweight CRM activity log): table `interactions` (`202409071803_initial_schema.cjs:380`): `type_id`, `contact_name_id`, `company_id`, `user_id`, `ticket_id`, `title` (renamed from description), `notes`, `start_time`/`end_time`, `status_id` (shared statuses, item_type `interaction`), `project_id` + visibility (`20251230090100`). Types: `interaction_types` + `system_interaction_types` (color, display_order, is_request). Settings UI `server/src/app/msp/settings/interactions/`; components `packages/clients/src/components/interactions/`.
- Tags (`packages/tags/`): polymorphic; `TaggedEntityType = 'client' | 'contact' | 'ticket' | 'project' | 'project_task' | 'workflow_form' | 'document' | 'knowledge_base_article'` (`packages/types/src/interfaces/tag.interfaces.ts:10`). No quote/opportunity types yet — extend the enum.

Integration hooks: `account_manager_id` = owner; `interactions` = ready activity/note log to attach opportunities to; tags extensible; prospect/pipeline lifecycle needs a new column or table. `clientPulseActions`/`commandCenterTypes` hint at an existing client-health surface to extend.

## 3. Agreements/contracts & billing

Core tables (`20251008000001_rename_billing_to_contracts.cjs`):
- `contracts` (header: `contract_id`, `contract_name`, `billing_frequency`, `currency_code`, `status`, `is_template`, `is_system_managed_default`; `owner_client_id` added `20260316120000`).
- `client_contracts` (assignment: `client_id`, `contract_id`, `start_date`, `end_date`, `is_active`, PO fields, renewal fields: `renewal_mode`, `notice_period_days`, `renewal_term_months`, `decision_due_date`, `renewal_cycle_start/end/key`, `evergreen_review_anchor_date`, ticket-creation policy fields).
- `contract_lines` + per-model config (`contract_line_fixed_config`, `contract_line_service_hourly_config(s)`, `contract_line_service_usage_config`, `contract_line_service_bucket_config`, `contract_line_service_rate_tiers`, `contract_line_discounts`); buckets (`bucket_plans`/`bucket_usage`); presets; templates; `contract_pricing_schedules` (`20251012000000`).
- Renewal queue: `IClientContractRenewalWorkItem` (status `pending|renewing|non_renewing|snoozed|completed`), migrations `202602211100`–`211130`.

Billing method taxonomy: `'Fixed' | 'Hourly' | 'Usage' | 'Bucket'` (`packages/types/src/interfaces/contractLineServiceConfiguration.interfaces.ts:11`). Interfaces in `packages/types/src/interfaces/contract.interfaces.ts` (`IContract`, `IClientContract` line 70, `IClientContractRenewalWorkItem`, `ContractStatus`).

Model/actions: `packages/clients/src/models/clientContract.ts` (renewal/evergreen logic), `clientContractActions.ts`, `clientContractLineActions.ts`. Contract UI/reports in `packages/billing/`.

MRR rollups exist: `packages/billing/src/actions/contractReportActions.ts` computes `monthly_value` per contract and `totalMRR` (lines 35, 52); report def `packages/reporting/src/lib/reports/definitions/contracts/expiration.ts` ("expiring contracts revenue", "renewal opportunities"). UI `packages/billing/src/components/billing-dashboard/reports/ContractReports.tsx`.

Integration hooks: quote→contract conversion targets these tables (`quotes.converted_contract_id`); renewal work-item queue is a proven "pipeline of dated decisions" pattern; `totalMRR`/`monthly_value` give a won-deal value source.

## 4. Activities / reminders / schedule

- User Activities dashboard = `packages/user-activities/` — aggregation feed, not its own table. `ActivityType` enum (`packages/types/src/interfaces/activity.interfaces.ts:25`): `schedule | projectTask | ticket | timeEntry | workflowTask | notification | document`. Aggregator `packages/user-activities/src/actions/activityAggregationActions.ts`. Nav `/msp/user-activities` (`menuConfig.ts:92`).
- Schedule = `packages/scheduling/`: `schedule_entries` with `work_item_type` CHECK `project_task | ticket | ad_hoc` (`20250103172553`), assignees, recurrence, private flag; `scheduleActions.ts`, appointment-request flow, online meetings, ICS generation.
- Reminders/tasks: `workflow_task_inbox` (`20250307201232`) surfaced via WORKFLOW_TASK activity type. No standalone reminder entity — reminders are ad_hoc schedule entries or workflow tasks.

Integration hooks: opportunity follow-ups → (a) new ActivityType source in the aggregator, (b) ad_hoc schedule entries, or (c) interactions with future dates. EE plan `workflow-crm-actions` already specs `crm.schedule_activity`.

## 5. Workflow automation engine

- Location: `shared/workflow/` (runtime, streams, actions, adapters, persistence, workers) + `packages/workflow-streams/` + `ee/packages/workflows/`. UI `/msp/workflow-control`, `/msp/workflow-editor` (`menuConfig.ts:192`). Forms `server/src/lib/workflow/forms/`.
- Event catalog: DB `system_event_catalog` (`20250505210649`; upserts `20260123150000_upsert_domain_workflow_event_catalog_v2.cjs`; types `shared/workflow/types/eventCatalog.ts`). Ships a **CRM category**: `CLIENT_CREATED/UPDATED/ARCHIVED/MERGED/OWNER_ASSIGNED`, `CLIENT_STATUS_CHANGED` ("prospect→active"), `CONTACT_*`, `INTERACTION_LOGGED`. Many are "proposedEvents" — cataloged for the Designer; check emission per-event.
- Emission: domain event builders `shared/workflow/streams/domainEventBuilders/` (already: `clientEventBuilders.ts`, `contactEventBuilders.ts`, `crmInteractionNoteEventBuilders.ts`, `contractEventBuilders.ts`, `tagEventBuilders.ts`, `appointmentEventBuilders.ts`). Publish helpers `packages/workflow-streams/src/streams/workflowEventPublishHelpers.ts`; Redis streams; `packages/event-bus/`.
- Actions: registered via `shared/workflow/runtime/registries/actionRegistry.ts` (`ActionDef<I,O>` with Zod schemas, idempotency, ui, handler). Business ops in `shared/workflow/runtime/actions/businessOperations/` — includes `crm.ts` (imports Quote, `convertQuoteToDraftContract` from `crmWorkerDal.ts`), plus `clients.ts`, `contacts.ts`, `activities.ts`, `scheduling.ts`, `email.ts`, `notifications.ts`, `tickets.ts`, `projects.ts`, `entityLinks.ts`. Today only `crm.create_activity_note` is live; EE plans `ee/docs/plans/2026-04-25-workflow-crm-actions/` + `.../workflow-crm-followup-actions/` roadmap `crm.find_activities`, `crm.update_activity`, `crm.schedule_activity`, `crm.send_quote`, `crm.create_quote`, `crm.add_quote_item`, `crm.create_quote_from_template`, `crm.find_quotes`, `crm.submit_quote_for_approval`, `crm.convert_quote`, `crm.tag_activity`.
- New-domain registration recipe: (1) catalog migration (cf. `20260702150000_seed_inventory_event_catalog.cjs`); (2) domain event builder + publish helpers; (3) actions with Zod schemas in `businessOperations/*.ts` + actionRegistry; (4) schema-derived Designer forms (`withWorkflowJsonSchemaMetadata`). Inventory (`ee/docs/plans/2026-06-26-inventory-module`) is the freshest end-to-end example.

## 6. Email

- Outbound = `packages/email/`: `SMTPEmailProvider`, `ResendEmailProvider`, `EmailProviderManager`; `TenantEmailService` / `SystemEmailService`; tenant template processors, locale resolution; `DelayedEmailQueue`; email logs (`/msp/email-logs`). Notifications layer `packages/notifications/`. Workflow email action `shared/workflow/actions/emailWorkflowActions.ts` + `workflowEmailRegistry.ts`. Quotes already send email (`/send|resend|remind`, `QuoteSendRecipientsField.tsx`).
- Inbound = `server/src/lib/inboundWebhooks/` (dispatcher, tenant/config resolution, idempotency, field mapping, `workflowEnvelope.ts`) + `shared/inboundWebhooks/externalEntityMappings.ts`; inbound-email→ticket via inbound ticket destinations (`packages/clients/src/actions/clientInboundEmailDomainActions.ts`, `inboundTicketDestinationActions.ts`). Events `INBOUND_EMAIL_REPLY_RECEIVED`, `EMAIL_BOUNCED/DELIVERED/UNSUBSCRIBED`. `email_to_ticket` capability flag in `productSurfaceRegistry.ts`.

Integration hooks: reuse `TenantEmailService` + templates for opportunity sends/follow-ups; inbound webhook + external-entity-mapping infra is the path for email-to-opportunity association.

## 7. Dashboards / reporting

- Reporting infra = `packages/reporting/src/lib/reports/`: registry-driven — `core/ReportRegistry.ts`, `core/ReportEngine.ts`, `builders/QueryBuilder.ts`, `actions/executeReport.ts`, declarative definitions in `definitions/` (e.g. `definitions/contracts/expiration.ts`). More in `packages/reporting/src/actions/` and `server/src/lib/reports/`. Nav `/msp/reports`.
- Dashboards: `server/src/app/msp/dashboard/` + `server/src/components/dashboard/`; billing dashboard incl. `ContractReports.tsx` (MRR); domain dashboards (inventory/surveys/sla/onboarding/client-portal).

Integration hooks: pipeline/attach-rate reports as new `definitions/` entries; pipeline widget on MSP dashboard. Quoting PRD explicitly deferred quote analytics as "build on top later."

## 8. Existing sales concepts

- Only artifacts: `quotes.opportunity_id` and the CRM workflow event catalog. No `opportunities`, `leads`, `pipelines`, `stages`, `deals` tables anywhere.
- `20260226171500_seed_team_member_leads.cjs` = team-member "leads" (managers), NOT sales leads — false positive.
- "Sales Orders" (`inventory_sales_orders`, `20260626100300`, `20260702140000_add_sales_order_quote_link.cjs`) belong to inventory (post-sale fulfillment). Nav group "Sales & Fulfillment" (`menuConfig.ts:329`) is inventory, not CRM. Note sales orders link back to quotes — another live quote linkage.
- EE planning docs pre-scoping CRM (under `ee/docs/plans/`): `2026-03-13-quoting-system/` (done; CRM opportunity tracking explicitly a non-goal, PRD lines 40, 424–426, 591), `2026-04-25-workflow-crm-actions/`, `2026-04-25-workflow-crm-followup-actions/`, `2026-04-25-workflow-client-actions/`, `2026-04-25-workflow-contact-actions/`, `2025-12-28-workflow-event-catalog/` (event-proposals.md defines CRM events).

## 9. Projects & onboarding

- Projects = `packages/projects/` (models, actions, schemas, components, settings). Shared statuses, task dependencies (`20250606130900`). **Project templates exist**: `/msp/projects/templates` (`menuConfig.ts:117`).
- `packages/onboarding/` = tenant first-run setup wizard, NOT per-client onboarding (`OnboardingWizard.tsx`, `lib/onboardingWizardSteps.ts`; `WizardData` in `packages/types/src/lib/onboardingWizard.ts`).

Integration hooks: won opportunity / accepted quote → spawn project from a project template, mirroring quote→draft-contract conversion. Renewal work-items demonstrate auto-creating work from a dated business event.

## 10. Extension / module patterns

- Package pattern: `packages/<name>/src/` with `models/`, `actions/` (withAuth-wrapped server actions), `schemas/` (Zod), `components/`, `hooks/`, `context/`, `lib/`, `index.ts`. Composition wiring in `packages/msp-composition/` (+ `packages/*-composition`). Inventory (`packages/inventory/`) is the newest full template.
- Navigation: `server/src/config/menuConfig.ts`.
- Product gating: `server/src/lib/productSurfaceRegistry.ts` — `PRODUCT_CODES`, `PRODUCT_CAPABILITIES` (`psa` = `['*']`, `algadesk` = curated subset), `MSP_ROUTE_RULES`/`ApiRule` (`allowed`/`upgrade_boundary`/`not_found`). New `/msp/<sales>` routes must be registered. Route guard `server/src/lib/serverProductRouteGuard.tsx`; settings tabs `server/src/lib/settingsProductTabs.ts`; product access `server/src/lib/productAccess.ts`.
- Tier gating/licensing: `server/src/lib/tier-gating/` (`assertTierAccess.ts`, `assertAddOnAccess.ts`, `ServerTierGate.tsx`, `getActiveAddOns.ts`) + `packages/licensing/`.
- Feature flags (PostHog): `packages/analytics/` + `server/src/lib/feature-flags/`; `useFeatureFlag` widely used — the soft-launch mechanism.
- RBAC: `packages/authorization/` + `server/src/lib/authorization/`. Permissions are `(tenant, resource, action)` rows with msp/client flags (`20250702181628`); example seed `20260320105000_add_quote_approval_permission.cjs`. ABAC kernel + bundles (`20260421190000`, plan `2026-04-21-premium-abac-authorization-kernel`).

"Add a module" checklist: package + msp-composition provider + menuConfig entry + productSurfaceRegistry route rules + permission-seeding migration + PostHog flag (inventory = reference implementation).

## 11. Relevant plan docs

- `ee/docs/plans/2026-03-13-quoting-system/` — quoting blueprint; `opportunity_id` forward-link rationale.
- `ee/docs/plans/2025-12-28-workflow-event-catalog/` — CRM event vocabulary.
- `ee/docs/plans/2026-04-25-workflow-crm-actions/`, `-followup-actions/`, `-client-actions/`, `-contact-actions/`.
- `docs/billing/quoting-system.md` — user-facing quote docs.
- No dedicated opportunity/CRM PRD exists yet — this plan directory is the first. Format: `ee/docs/plans/<slug>/{PRD.md,features.json,tests.json}` per the alga-plan convention.

## Orientation summary

The greenfield is narrow: an opportunity/pipeline data model (stages, records, value, expected close, owner) and its UI. Almost everything it must touch already exists and in several places was pre-wired for it: `quotes.opportunity_id` is a dangling link waiting for a table; `account_manager_id` gives ownership; interactions + tags + notes give an activity/timeline substrate; the workflow engine already has a CRM event category and a `crm.*` action module with a documented expansion roadmap; contracts/quotes give won-deal conversion + MRR value; reporting/dashboards are registry-driven; the module-registration path is well-trodden. The notable schema gap to resolve deliberately: no client sales-lifecycle/prospect status exists today, even though the workflow catalog already names a `prospect→active` transition.
