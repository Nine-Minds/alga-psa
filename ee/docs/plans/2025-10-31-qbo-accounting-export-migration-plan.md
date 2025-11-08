# QuickBooks Online Accounting Export Migration Plan

## Purpose & Goals
- Replace the bespoke QuickBooks Online (QBO) workflow automations with the shared accounting export abstraction already used by Xero (`accountingExportService`, adapter registry, manual batch execution).
- Keep the OAuth connection sequence (`server/src/app/api/integrations/qbo/callback/route.ts`) but eliminate automatic event-triggered exports in favor of operator-driven batches.
- Deliver a consistent mapping and export UX (realm-aware, multi-adapter) so finance teams manage QBO mappings alongside Xero from the accounting settings and export dashboards.
- Ensure the new flow supports multiple QBO realms per tenant, preserves audit trails, and is covered by automated tests comparable to the Xero adapter.

## Current State Overview
### QBO Event-Driven Sync (legacy)
- OAuth callback registers workflow event attachments for `INVOICE_CREATED`, `INVOICE_UPDATED`, `CLIENT_CREATED`, `CLIENT_UPDATED` (see `server/src/app/api/integrations/qbo/callback/route.ts`).
- Workflows under `server/src/lib/workflows/qboInvoiceSyncWorkflow.ts` and `server/src/lib/workflows/qboCustomerSyncWorkflow.ts` orchestrate exports via workflow actions, human-in-the-loop tasks, and direct database reads.
- Workflow-callable actions (`server/src/lib/actions/qbo/qboInvoiceActions.ts`, `server/src/lib/actions/qbo/qboCustomerActions.ts`) wrap `QboClientService`, but embed mapping lookups, manual retries, and sync token handling outside the accounting export abstraction.
- Event listener (`callback/route.ts`) creates `workflow_event_attachments` entries so PSA events automatically trigger the workflows. Human approvals are handled through workflow tasks instead of accounting export batches.

### Accounting Export Baseline (Xero)
- Xero integration already uses the export abstraction: `server/src/lib/adapters/accounting/xeroAdapter.ts` for transform/deliver, `server/src/lib/qbo` analogue for client service, and `AccountingExportService.executeBatch` for orchestration.
- Export batches are created manually from the accounting exports UI (`server/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`), validated for mappings, and delivered via adapters.
- Mapping UI uses `AccountingMappingManager` with adapter-specific module factories (e.g., `server/src/components/integrations/xero/xeroMappingModules.ts`) and shared CRUD actions.

### Gap Summary
- Duplicate export paths: invoices can flow through workflows or the canonical export batches, creating inconsistent audit trails and error handling.
- Legacy workflows bake in client mapping logic, duplicate detection, and task handling that should move into shared services (`AccountingMappingResolver`, `CompanyAccountingSyncService`).
- Event attachments assume a single realm per tenant and bypass export readiness checks. Operators cannot stage exports or view batch history when workflows run automatically.
- Qbo mapping UI exists (`server/src/components/integrations/qbo/qboMappingModules.ts`) but is not yet wired to the same lifecycle as Xero (realm display, validations, manual runs) while workflows still expect legacy mapping helpers.

## Target Outcomes
- Manual/export screen-driven QBO deliveries using `AccountingExportService` and `QuickBooksOnlineAdapter`.
- OAuth connect/disconnect remains intact; connecting a realm exposes the mapping manager and enables manual exports.
- Removed workflow/event plumbing so PSA events no longer trigger QBO exports; any needed automation should invoke the canonical batch APIs instead.
- Documentation, tests, and operational runbooks updated to reflect the new flow and deprecation of workflow-based sync.

---

## Phase 1 – Legacy Workflow Decommissioning
- [x] Stop creating workflow event attachments during OAuth callback; update `server/src/app/api/integrations/qbo/callback/route.ts` to only persist credentials and emit connection telemetry.
- [x] Remove QBO-specific workflow handlers by deleting `server/src/lib/workflows/qboInvoiceSyncWorkflow.ts` and `server/src/lib/workflows/qboCustomerSyncWorkflow.ts`.
- [x] Detach any remaining shared workflow registrations or catalog references to the removed QBO workflows (`shared/workflow/init/registerWorkflowActions.ts`, `shared/workflow/streams/eventBusSchema.ts`, `shared/workflow/types/eventCatalog.ts`).
- [x] Retire workflow action shims in `server/src/lib/actions/qbo/qboInvoiceActions.ts` and `server/src/lib/actions/qbo/qboCustomerActions.ts`; ensure no remaining workflows depend on them.
- [x] Author a migration script to delete `workflow_event_attachments` rows referencing the removed workflow IDs.
- [x] Update operator documentation to instruct cancellation of any legacy QBO workflow executions prior to deploy.
- [x] Communicate deprecation to stakeholders; update `docs/integrations/quickbooks-technical.md` and internal runbooks to remove references to automatic invoice/customer workflows.

## Phase 2 – Adapter & Service Parity
- [x] Validate `server/src/lib/adapters/accounting/quickBooksOnlineAdapter.ts` against the latest Xero adapter patterns (mapping resolution, payment term fallbacks, tax handling, customer auto-provision) and close remaining TODOs (metadata typing, line amount types, partial retries).
- [x] Harden `QboClientService` to expose the same high-level operations Xero uses (`createInvoices`, token refresh telemetry, rate limit handling) and ensure adapter calls go through typed methods.
- [x] Extend `AccountingExportValidation` to enforce QBO-specific prerequisites (service, tax region, payment term mappings, customer realm assignment) and surface actionable error codes.
- [x] Build integration tests mirroring Xero coverage (`server/src/test/integration/accounting/*`) to exercise QuickBooks transform/deliver flows, including multi-realm scenarios and sync token updates.
- [x] Provide repository helpers for invoice export mappings (re-using or expanding `fetchInvoiceMapping`/`upsertInvoiceMapping` inside the adapter) so repeated deliveries update sync tokens reliably.

## Phase 3 – Mapping & Setup UX Alignment
- [x] Finalize `server/src/components/integrations/qbo/qboMappingModules.ts` to match `AccountingMappingManager` expectations (realm-aware load, metadata JSON editor, overrides) and remove unused bespoke components (`QboMappingFormDialog`, `QboItemMappingTable`, etc.) once parity is confirmed.
- [x] Ensure `server/src/components/settings/integrations/QboIntegrationSettings.tsx` mirrors Xero’s experience: connected state displays realm ID, mapping tabs, and validation hints; disconnected state hides export controls.
- [x] Add realm selector/feedback when tenants have multiple QBO connections, reusing context shape (`realmId`, `realmDisplayValue`) used by Xero.
- [x] Audit shared mapping actions (`server/src/lib/actions/externalMappingActions.ts`, `server/src/lib/actions/integrations/qboActions.ts`) for permissions, caching, and error messages suitable for the new UI.
- [x] Update Playwright stories/tests under `ee/server/src/__tests__/integration` to cover QBO mapping CRUD using the generic components.

## Phase 4 – Export Execution Integration
- [x] Update accounting export UI flows (`server/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`) to highlight QBO-specific requirements (realm selection, mapping completeness) and reuse the preview API.
- [x] Ensure CLI/automation scripts (`scripts/trigger-accounting-export.ts`) support `quickbooks_online` by default with updated implementation notes for engineering users.

---

## Dependencies & Considerations
- Accounting export tables (`accounting_export_batches`, `accounting_export_lines`, `accounting_export_errors`) and services must remain stable; coordinate with ongoing work tracked in `2025-10-26-accounting-export-abstraction-plan.md`.
- Multi-realm credential storage (`QboClientService`, tenant secrets) must support selecting the correct realm per batch; ensure mapping resolver requests include `target_realm`.
- Ensure no other workflows rely on QBO events before deleting schema/catalog definitions.
- Staging environments need valid QBO sandbox credentials to validate adapter deliver calls end-to-end.

## Risks & Mitigations
- **Risk:** Removing workflows before manual exports are ready could block invoice delivery.  
  **Mitigation:** Gate removal behind feature flag, complete adapter validation and smoke tests prior to rollout.
- **Risk:** Token refresh differences between workflows and adapter could introduce auth regressions.  
  **Mitigation:** Expand `QboClientService` unit tests and add integration coverage for token refresh flows.
- **Risk:** Existing workflow tasks or attachments may remain orphaned.  
  **Mitigation:** Run migration + cleanup script and notify workflow service owners.
- **Risk:** Finance teams rely on auto-sync cadence.  
  **Mitigation:** Provide scheduling via Automation Hub that uses `AccountingExportService` API once workflows are gone.

## Open Questions
- Do any external automations (Zapier, bespoke scripts) invoke the removed workflow actions? Need inventory before deletion.
- Should we preserve parts of the human-in-the-loop conflict detection (duplicate customers) within the mapping resolver or provide a separate review queue?
- What SLA/timing expectations exist for exports now that they become manual/automation-driven rather than event triggered?
- Are additional mapping entities (classes/departments, locations) required before phasing out the workflows?
