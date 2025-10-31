Company ↔ Accounting System Sync Plan
=====================================

Phase 1 – Discovery & Architecture *(Status: ✅ Completed)*
----------------------------------------------------------
1. Audit current company usage *(done)*:
   - Reviewed `tenant_external_entity_mappings` for existing company/client records and realm handling.
   - Catalogued required company fields across Xero and QuickBooks APIs.
   - Documented gaps between Alga’s company model and external requirements.
2. Define shared abstractions *(done)*:
   - Specified `AccountingCompanyAdapter` interface and shared types.
   - Delivered orchestrator service (`CompanyAccountingSyncService`) contract and responsibilities.
   - Shipped `server/src/lib/services/companySync` module with service, repository, adapters, and normalizer skeleton.
   - Established metadata schema for stored mappings (sync tokens, raw payloads, realm-awareness).

Phase 2 – Shared Sync Layer Implementation *(Status: ✅ Completed)*
-----------------------------------------------------------------
1. Implement orchestrator *(done)*:
   - Built lookup/create/update workflow with tenant + realm awareness and in-memory caching.
   - Leveraged DB uniqueness for concurrency protection and handled duplicate insert races.
   - Left structured logging hooks for future telemetry pass.
2. Update `AccountingMappingResolver` *(done)*:
   - Added `ensureCompanyMapping` helper and adapter-type normalization with caching.
   - Replaced direct table lookups with orchestrator integration.
3. Provide utility for data normalization *(done)*:
   - Added DTO builder to convert Alga company data with sensible fallbacks for optional fields and contacts.

Phase 3 – Adapter Integrations *(Status: 🟡 In Progress)*
--------------------------------------------------------
1. Xero *(done)*:
   - Implemented `XeroCompanyAdapter` using `XeroClientService` with duplicate detection + metadata preservation.
   - Refactored `XeroAdapter` invoice transform to call `ensureCompanyMapping` during exports.
2. QuickBooks Online/Desktop *(partial)*:
   - Delivered `QuickBooksOnlineCompanyAdapter` with sync token handling and wired invoice transform through `ensureCompanyMapping`.
   - Outstanding: QuickBooks Desktop parity and any additional realm nuances.
3. Manual sync endpoints *(not started)*:
   - API triggers for per-company refresh remain to be designed and scoped.

Phase 4 – UI & Admin Enhancements
---------------------------------
1. Integration settings:
   - Display company mapping status list (mapped/unmapped, last sync).
   - Provide “Link existing” and “Sync now” controls that invoke the shared service.
2. Export dashboard:
   - Surface mapping errors originating from the new service.
   - Indicate when a company was auto-created during export.

Phase 5 – Testing & Quality
---------------------------
1. Unit tests:
   - Extend `xeroAdapter.spec.ts` for creation vs reuse scenarios.
   - Update `xeroClientService.spec.ts` with contact payload/idempotency cases.
   - Add analogous tests for QuickBooks company adapters and client services.
2. Integration tests:
   - Expand `exportDashboard.integration.test.ts` to cover auto-create, reuse, and concurrency.
   - Add API-level tests for manual sync endpoints.
3. Sandbox QA:
   - Validate end-to-end flows in a tenant with both Xero and QuickBooks connections.
   - Run backfill script and verify mappings/audit logs.

Phase 6 – Rollout & Backfill
----------------------------
1. Deployment readiness:
   - Document configuration changes, feature flags, and rollback steps.
   - Ensure observability dashboards/alerts are in place.
2. Backfill execution:
   - Run orchestrator-driven job to populate missing company mappings.
   - Monitor for failures; re-run or queue manual review as needed.
3. Post-release monitoring:
   - Track export success rates and mapping creation events.
   - Collect feedback from finance teams for iterative improvements.
