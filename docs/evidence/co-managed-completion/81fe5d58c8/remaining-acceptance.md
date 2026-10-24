# Remaining acceptance obligations

Candidate: `83d61543cabb46c64c1a35eb3a75f5252dd5e4f1`.

Every approved ID is retained below. Source locations are a census, not proof that the complete requirement passed.
No source-only record is promoted to verified. External portions retain their release owner.

## T01

Status: `implemented-unverified`.

Product matrix — Customer can use agreed operational features through UI/API/actions; billing, sales, unsupported integrations, and nested sponsorship are denied. PSA/AlgaDesk behavior remains intact.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T01).

Implementation: `server/src/lib/productSurfaceRegistry.ts`, `server/migrations/utils/permissions/catalog.cjs`.

Regression locations: `server/src/test/unit/product/coManagedProductSurface.test.ts`.

Still required: Product matrix — Customer can use agreed operational features through UI/API/actions; billing, sales, unsupported integrations, and nested sponsorship are denied. PSA/AlgaDesk behavior remains intact. Complete product/role/entry-point acceptance; source and unit coverage do not establish every operational UI/API journey.

## T02

Status: `implemented-unverified`.

Purchase separation — Confirmed monthly purchase increases only co-managed capacity. Duplicate/out-of-order webhook reconciliation, regular Pro seat changes, and annual Pro sponsorship preserve the correct quantities/prices.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T02).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Purchase separation — Confirmed monthly purchase increases only co-managed capacity. Duplicate/out-of-order webhook reconciliation, regular Pro seat changes, and annual Pro sponsorship preserve the correct quantities/prices. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## T03

Status: `implemented-unverified`.

Self-host claims — Pro with explicit capacity works offline within signed validity; old/unbound-to-sponsor/missing-capacity/invalid licenses cannot provision. Customer allocations do not consume regular MSP seats or inherit another tenant's independent license.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T03).

Implementation: `packages/licensing/src/lib/co-managed-license.ts`, `packages/licensing/src/lib/co-managed-entitlements.ts`.

Regression locations: `packages/licensing/src/lib/co-managed-license.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Self-host claims — Pro with explicit capacity works offline within signed validity; old/unbound-to-sponsor/missing-capacity/invalid licenses cannot provision. Customer allocations do not consume regular MSP seats or inherit another tenant's independent license. Exercise normal signed-license import/refresh and independent upgrade controls; raw entitlement fixtures alone do not satisfy the signed-license journey.

## T04

Status: `implemented-unverified`.

Allocation concurrency — Concurrent last-seat allocation, invitation, acceptance, import, and reactivation cannot oversubscribe. Failed/retried provisioning releases or reuses reservations without duplicate tenants/users.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T04).

Implementation: `packages/licensing/src/lib/co-managed-admission.ts`, `packages/licensing/src/lib/co-managed-reservation.ts`.

Regression locations: `server/src/test/integration/coManagedReservations.integration.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Allocation concurrency — Concurrent last-seat allocation, invitation, acceptance, import, and reactivation cannot oversubscribe. Failed/retried provisioning releases or reuses reservations without duplicate tenants/users. Attach candidate-specific capacity/race results to this requirement and complete its required hosted/self-host controls.

## T05

Status: `implemented-unverified`.

Topology/provisioning — New customer is linked to the intended local client, has one sponsor and correct seeds, and requires configured activation. Existing-tenant attachment, second sponsor, nested relationship, and different-installation targets fail.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T05).

Implementation: `packages/co-managed/src/provisioning.ts`, `packages/co-managed/src/acceptance.ts`, `server/src/components/co-managed/CoManagedClientSetup.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedAcceptanceActions.test.ts`.

Still required: Topology/provisioning — New customer is linked to the intended local client, has one sponsor and correct seeds, and requires configured activation. Existing-tenant attachment, second sponsor, nested relationship, and different-installation targets fail. Complete fresh-client invitation/setup/acceptance through the application and actual delivery/worker composition; database fixtures cover only part of the journey.

## T06

Status: `implemented-unverified`.

Isolation matrix — Two MSPs, multiple customers, requester, customer technician/admin, and differently scoped MSP roles exercise list/detail/mutation/API/search/count/report/download/realtime paths. Denied siblings, private boards, foreign IDs, and stale grants expose no contents or counts.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T06).

Implementation: `packages/co-managed/src/sharedWork.ts`, `packages/co-managed/src/customerWork.ts`, `packages/co-managed/src/sharedWorkRead.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedSharedWorkActions.test.ts`.

Still required: Isolation matrix — Two MSPs, multiple customers, requester, customer technician/admin, and differently scoped MSP roles exercise list/detail/mutation/API/search/count/report/download/realtime paths. Denied siblings, private boards, foreign IDs, and stale grants expose no contents or counts. Complete the full two-session API/search/download/realtime/queued-delivery matrix; a ticket collision regression covers only part of it.

## T07

Status: `implemented-unverified`.

Delegated administration — MSP delegates can perform only granted settings/user operations; they cannot expand scope, impersonate customer admins, reset their credentials, reveal private notes, or turn ordinary users into privileged proxies.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T07).

Implementation: `packages/co-managed/src/delegatedAdministration.ts`, `server/src/components/co-managed/CoManagedDelegatedAdministration.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedDelegatedAdministrationActions.test.ts`.

Still required: Delegated administration — MSP delegates can perform only granted settings/user operations; they cannot expand scope, impersonate customer admins, reset their credentials, reveal private notes, or turn ordinary users into privileged proxies. Complete customer-approved delegation and revoked-scope application journeys; source presence cannot accept these scenarios.

## T08

Status: `implemented-unverified`.

Shared ticket lifecycle — Customer creates one ticket; oversight sees it without working-queue placement or MSP SLA. Escalation adds immediate MSP responsibility, queue placement, one handoff, and one SLA start. Retry, handback, re-escalation, close, reopen, and bulk operations preserve one authoritative ticket.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T08).

Implementation: `packages/co-managed/src/ticketHandoffs.ts`, `packages/co-managed/src/ticketEditing.ts`, `server/src/components/co-managed/CoManagedTicketSection.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedTicketSection.test.tsx`.

Still required: Shared ticket lifecycle — Customer creates one ticket; oversight sees it without working-queue placement or MSP SLA. Escalation adds immediate MSP responsibility, queue placement, one handoff, and one SLA start. Retry, handback, re-escalation, close, reopen, and bulk operations preserve one authoritative ticket. Complete the normal application handoff/retry/close/reopen journey with canonical ownership and qualified mapping evidence.

## T09

Status: `implemented-unverified`.

Content audiences — Both organizations and portal users see exactly their permitted notes/threads/attachments. Foreign authors retain attribution. Email previews, notifications, search, exports, and shared project comments never disclose organization-private content.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T09).

Implementation: `packages/co-managed/src/ticketConversation.ts`, `packages/co-managed/src/ticketCommentCreation.ts`, `packages/co-managed/src/conversationAttachments.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedTicketCommentActions.test.ts`.

Still required: Content audiences — Both organizations and portal users see exactly their permitted notes/threads/attachments. Foreign authors retain attribution. Email previews, notifications, search, exports, and shared project comments never disclose organization-private content. Complete requester/shared/private admission through application, portal, files and queued consumers; automated service cases are partial evidence.

## T10

Status: `implemented-unverified`.

Canonical routing — Different customer/MSP board/status/priority sets and identical ticket numbers remain unambiguous. MSP edits use customer-valid statuses; local queue placement cannot corrupt owner-tenant FKs or silently remap priority targets.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T10).

Implementation: `packages/co-managed/src/ticketHandoffs.ts`, `packages/co-managed/src/ticketEditing.ts`, `server/src/components/co-managed/CoManagedTicketSection.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedTicketSection.test.tsx`.

Still required: Canonical routing — Different customer/MSP board/status/priority sets and identical ticket numbers remain unambiguous. MSP edits use customer-valid statuses; local queue placement cannot corrupt owner-tenant FKs or silently remap priority targets. Complete the normal application handoff/retry/close/reopen journey with canonical ownership and qualified mapping evidence.

## T11

Status: `implemented-unverified`.

Consolidated views — Mixed native/shared tickets sort, paginate, count, filter, and export correctly; unauthorized/stale projection rows cannot leak or create false totals. Routine shared ticket/project actions do not switch sessions.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T11).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Consolidated views — Mixed native/shared tickets sort, paginate, count, filter, and export correctly; unauthorized/stale projection rows cannot leak or create false totals. Routine shared ticket/project actions do not switch sessions. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## T12

Status: `implemented-unverified`.

Project collaboration — Explicit sharing permits both teams to assign and work on the same tasks; unshared projects remain private. Shared grants do not assign all work automatically. Revocation closes live access.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T12).

Implementation: `packages/co-managed/src/projectTaskEditing.ts`, `packages/co-managed/src/projectTaskQueue.ts`, `server/src/components/co-managed/CoManagedProjectTaskEditor.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedProjectTaskEditor.test.tsx`.

Still required: Project collaboration — Explicit sharing permits both teams to assign and work on the same tasks; unshared projects remain private. Shared grants do not assign all work automatically. Revocation closes live access. Complete actual shared-task picker, collaboration and revocation journeys; retain unshared-project denial.

## T13

Status: `implemented-unverified`.

Time and billing — Customer can log time without service/contract setup. MSP logs time on the same customer work and invoices only its own approved effort using its local client/profile/contract. Include contract-backed and catalog-priced time, edits, approvals, and double-invoice prevention. Native billing remains correct.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T13).

Implementation: `packages/co-managed/src/nativeTimeDispatch.ts`, `packages/co-managed/src/nativeTimeSheetList.ts`, `packages/co-managed/src/timeBillingProfile.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedTimeEntry.test.tsx`.

Still required: Time and billing — Customer can log time without service/contract setup. MSP logs time on the same customer work and invoices only its own approved effort using its local client/profile/contract. Include contract-backed and catalog-priced time, edits, approvals, and double-invoice prevention. Native billing remains correct. Complete native grid/detail/export/approval/invoice application journeys and confirm totals/privacy; service tests do not establish screen usability.

## T14

Status: `implemented-unverified`.

Effort totals — Customer/MSP task contributions, time edits/deletes/moves, private timesheet fields, and optional approvals produce accurate organization-separated and permitted combined effort views.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T14).

Implementation: `packages/co-managed/src/nativeTimeDispatch.ts`, `packages/co-managed/src/nativeTimeSheetList.ts`, `packages/co-managed/src/timeBillingProfile.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedTimeEntry.test.tsx`.

Still required: Effort totals — Customer/MSP task contributions, time edits/deletes/moves, private timesheet fields, and optional approvals produce accurate organization-separated and permitted combined effort views. Complete native grid/detail/export/approval/invoice application journeys and confirm totals/privacy; service tests do not establish screen usability.

## T15

Status: `implemented-unverified`.

SLA independence — Customer work before escalation never consumes MSP time. Different calendars/priorities, qualifying response authors/audiences, handback pauses, re-escalation resumes, breaches, retries, closure, and both backend implementations maintain independent obligations.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T15).

Implementation: `packages/co-managed/src/ticketSla.ts`, `server/src/components/co-managed/CoManagedSlaPolicyPanel.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedOrganizationSlaClock.test.ts`.

Still required: SLA independence — Customer work before escalation never consumes MSP time. Different calendars/priorities, qualifying response authors/audiences, handback pauses, re-escalation resumes, breaches, retries, closure, and both backend implementations maintain independent obligations. Exercise escalation/reply/handback/close/reopen with both running SLA backends and duplicate consumer delivery.

## T16

Status: `implemented-unverified`.

Revocation race — An open page, cached search result, queued email/notification, workflow, or concurrent command cannot continue using revoked grants. Only already-authorized historical evidence remains available.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T16).

Implementation: `packages/co-managed/src/sharedWork.ts`, `packages/co-managed/src/customerWork.ts`, `packages/co-managed/src/sharedWorkRead.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedSharedWorkActions.test.ts`.

Still required: Revocation race — An open page, cached search result, queued email/notification, workflow, or concurrent command cannot continue using revoked grants. Only already-authorized historical evidence remains available. Complete the full two-session API/search/download/realtime/queued-delivery matrix; a ticket collision regression covers only part of it.

## T17

Status: `implemented-unverified`.

Lapse/recovery — Durable 30-day deadline blocks growth immediately and writes after expiry across interactive/API/background intake. Renewal recovers without extending an old lapse improperly, losing email, or duplicating processing. Reduced external capacity does not arbitrarily delete users.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T17).

Implementation: `packages/licensing/src/lib/co-managed-lifecycle.ts`, `packages/co-managed/src/inboundRequesterReply.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Lapse/recovery — Durable 30-day deadline blocks growth immediately and writes after expiry across interactive/API/background intake. Renewal recovers without extending an old lapse improperly, losing email, or duplicating processing. Reduced external capacity does not arbitrarily delete users. Complete original-deadline lapse and once-only renewal through both deployed worker compositions.

## T18

Status: `implemented-unverified`.

Archive/export/restore — MSP archive contains only participated-in shared work and its own private/commercial data; customer export excludes it. Restore customer records, attribution, files, configuration, and encrypted business credentials in isolation. OAuth/session secrets and old live trust do not carry over.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T18).

Implementation: `packages/co-managed/src/portableExport.ts`, `packages/co-managed/src/portableTransfer.ts`, `server/src/components/co-managed/CoManagedPortableExport.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedPortableExport.test.tsx`.

Still required: Archive/export/restore — MSP archive contains only participated-in shared work and its own private/commercial data; customer export excludes it. Restore customer records, attribution, files, configuration, and encrypted business credentials in isolation. OAuth/session secrets and old live trust do not carry over. Complete source-unavailable export/restore through native screens; compare permitted records/files/credentials and prove tamper/interruption recovery.

## T19

Status: `implemented-unverified`.

Independent upgrade — Hosted customer buys its own PSA subscription or self-hosted customer obtains its own license; data remains, commercial capabilities initialize once, sponsorship ends, capacity releases once, and MSP billing/other customers stay unchanged. Failed payment/seed retry leaves recoverable state.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T19).

Implementation: `packages/co-managed/src/independentUpgrade.ts`, `server/src/components/co-managed/CoManagedUpgrade.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedUpgrade.test.tsx`.

Still required: Independent upgrade — Hosted customer buys its own PSA subscription or self-hosted customer obtains its own license; data remains, commercial capabilities initialize once, sponsorship ends, capacity releases once, and MSP billing/other customers stay unchanged. Failed payment/seed retry leaves recoverable state. Complete hosted/signed-license independent upgrade through normal controls and exactly-once release/activation recovery.

## T20

Status: `implemented-unverified`.

Deletion and migration — Customer deletion after departure leaves MSP invoices/archive usable. Fresh install and upgrade migrations pass PostgreSQL and Citus constraints; local actor/audience backfills do not widen existing access.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T20).

Implementation: `packages/co-managed/src/archiveReads.ts`, `packages/co-managed/src/departure.ts`, `packages/co-managed/src/relationshipClosure.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedArchive.test.tsx`.

Still required: Deletion and migration — Customer deletion after departure leaves MSP invoices/archive usable. Fresh install and upgrade migrations pass PostgreSQL and Citus constraints; local actor/audience backfills do not widen existing access. Exercise actual customer deletion and retained MSP invoice/archive access; PostgreSQL/Citus runtime invariants need their own acceptance.

## T21

Status: `implemented-unverified`.

UI release boundary — On both deployment modes, disabled/loading/unknown/error flag states expose no usable co-managed entry points or content, including direct browser navigation. Enabled `release-v1-6-feature` reveals the permitted feature UI. Ordinary PSA/AlgaDesk UI remains usable.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T21).

Implementation: `server/src/components/co-managed/CoManagedFeatureBoundary.tsx`, `server/src/app/msp/MspLayoutClient.tsx`.

Regression locations: `server/src/test/unit/product/coManagedFeatureBoundary.test.tsx`, `server/src/test/unit/product/coManagedT21Boundary.contract.test.ts`.

Still required: UI release boundary — On both deployment modes, disabled/loading/unknown/error flag states expose no usable co-managed entry points or content, including direct browser navigation. Enabled `release-v1-6-feature` reveals the permitted feature UI. Ordinary PSA/AlgaDesk UI remains usable. Complete real flag-off/direct-route/portal and backend-authority matrix; ordinary PSA/AlgaDesk fallback must remain usable.

## T22

Status: `implemented-unverified`.

Backend flag independence — With `release-v1-6-feature` off, authorized direct API/server-action operations and route access still work under normal product/license rules. Existing provisioning, email intake, workflows, billing, and SLA processing remain functional. Unauthorized operations remain denied for their ordinary authorization reasons, independent of flag state.

Specification: `docs/plans/2026-09-06-co-managed-it-plan.md` (T22).

Implementation: `server/src/components/co-managed/CoManagedFeatureBoundary.tsx`, `server/src/app/msp/MspLayoutClient.tsx`.

Regression locations: `server/src/test/unit/product/coManagedFeatureBoundary.test.tsx`, `server/src/test/unit/product/coManagedT21Boundary.contract.test.ts`.

Still required: Backend flag independence — With `release-v1-6-feature` off, authorized direct API/server-action operations and route access still work under normal product/license rules. Existing provisioning, email intake, workflows, billing, and SLA processing remain functional. Unauthorized operations remain denied for their ordinary authorization reasons, independent of flag state. Complete real flag-off/direct-route/portal and backend-authority matrix; ordinary PSA/AlgaDesk fallback must remain usable.

## clientIntegration:F001

Status: `implemented-unverified`.

Provide an authorized per-client co-managed read endpoint that discovers all relevant sponsor-owned mappings without filtering a paginated global list in the browser.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F001).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Provide an authorized per-client co-managed read endpoint that discovers all relevant sponsor-owned mappings without filtering a paginated global list in the browser. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F002

Status: `implemented-unverified`.

Replace operation-based resolveTarget navigation with explicit customer-home and sponsor-client selectors, preserving tracked browser identity, home record policy, qualified relationship validation, and transaction lock order.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F002).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Replace operation-based resolveTarget navigation with explicit customer-home and sponsor-client selectors, preserving tracked browser identity, home record policy, qualified relationship validation, and transaction lock order. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F003

Status: `implemented-unverified`.

Handle absent, single, multiple, ended, inconsistent, and forbidden client relationships explicitly and require exact expected relationship identity for writes.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F003).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Handle absent, single, multiple, ended, inconsistent, and forbidden client relationships explicitly and require exact expected relationship identity for writes. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F004

Status: `implemented-unverified`.

Prevent concurrent client Enable submissions with different operation IDs from starting duplicate current workspaces while preserving existing multiple relationships and acknowledged cleanup/new-setup behavior.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F004).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Prevent concurrent client Enable submissions with different operation IDs from starting duplicate current workspaces while preserving existing multiple relationships and acknowledged cleanup/new-setup behavior. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F005

Status: `implemented-unverified`.

Migrate all six policy/SLA resolveTarget consumers to the new selector and common browser actor handling while retaining revisions and customer-owned sharing authority.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F005).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrate all six policy/SLA resolveTarget consumers to the new selector and common browser actor handling while retaining revisions and customer-owned sharing authority. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F006

Status: `implemented-unverified`.

Use the same authorized client relationship selection for sponsor delegation, departure, allocation, and setup recovery adapters without changing engine operation or command receipts.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F006).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Use the same authorized client relationship selection for sponsor delegation, departure, allocation, and setup recovery adapters without changing engine operation or command receipts. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F007

Status: `implemented-unverified`.

Resolve legacy sponsor operation/client URLs to the authorized canonical client and exact relationship, reject conflicting selectors, and preserve customer-home and qualified work routes.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F007).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Resolve legacy sponsor operation/client URLs to the authorized canonical client and exact relationship, reject conflicting selectors, and preserve customer-home and qualified work routes. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F008

Status: `implemented-unverified`.

Return lifecycle, per-action authority, redacted client/workspace metadata, and seat usage consistent with active-technician and distinct-live-invitation admission counts.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F008).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Return lifecycle, per-action authority, redacted client/workspace metadata, and seat usage consistent with active-technician and distinct-live-invitation admission counts. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F009

Status: `implemented-unverified`.

Add an optional client co-managed render-child composition seam through ClientCrossFeatureContext and MspClientCrossFeatureProvider with app-owned injection in WorkspaceProviders and no reverse package imports.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F009).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Add an optional client co-managed render-child composition seam through ClientCrossFeatureContext and MspClientCrossFeatureProvider with app-owned injection in WorkspaceProviders and no reverse package imports. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F010

Status: `implemented-unverified`.

Render a client-authorized compact relationship/seat summary with state-appropriate Enable or Manage navigation and shared refresh state with the client view.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F010).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Render a client-authorized compact relationship/seat summary with state-appropriate Enable or Manage navigation and shared refresh state with the client view. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F011

Status: `implemented-unverified`.

Register the stable co-managed client view in the full-page command center Service rail and full drawer tabs, with a full-client link from Details-only quick view.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F011).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Register the stable co-managed client view in the full-page command center Service rail and full drawer tabs, with a full-client link from Details-only quick view. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F012

Status: `implemented-unverified`.

Handle asynchronous deep-link registration, denied/unavailable fallback, flag transitions, stale client/relationship responses, and dialog unmount without breaking ordinary client views.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F012).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Handle asynchronous deep-link registration, denied/unavailable fallback, flag transitions, stale client/relationship responses, and dialog unmount without breaking ordinary client views. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F013

Status: `implemented-unverified`.

Keep client/relationship-specific drafts across local section changes, guard unsaved dismissal, and namespace controls for simultaneous full-page/drawer instances.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F013).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Keep client/relationship-specific drafts across local section changes, guard unsaved dismissal, and namespace controls for simultaneous full-page/drawer instances. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F014

Status: `implemented-unverified`.

Extract client-fixed setup with prefilled workspace name, initial administrator, allocation, visibility, escalation destination, and distinct customer acceptance state.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F014).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Extract client-fixed setup with prefilled workspace name, initial administrator, allocation, visibility, escalation destination, and distinct customer acceptance state. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F015

Status: `implemented-unverified`.

Expose provisioning progress, retry, invitation resend, cancellation, and acknowledged cleanup in the client view using the original operation after uncertain responses.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F015).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Expose provisioning progress, retry, invitation resend, cancellation, and acknowledged cleanup in the client view using the original operation after uncertain responses. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F016

Status: `implemented-unverified`.

Manage client allocation beside usage and pending reservations, preserving expected-seat checks, minimum allocation, lapse/growth restrictions, and permitted reductions.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F016).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Manage client allocation beside usage and pending reservations, preserving expected-seat checks, minimum allocation, lapse/growth restrictions, and permitted reductions. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F017

Status: `implemented-unverified`.

Embed MSP staff assignments, read-only customer-approved sharing, existing SLA mappings, and permitted delegated actions within the selected client's relationship view.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F017).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Embed MSP staff assignments, read-only customer-approved sharing, existing SLA mappings, and permitted delegated actions within the selected client's relationship view. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F018

Status: `implemented-unverified`.

Expose relationship departure and historical/archive navigation from the client without reading live customer identity/content after the relationship ends.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F018).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Expose relationship departure and historical/archive navigation from the client without reading live customer identity/content after the relationship ends. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F019

Status: `implemented-unverified`.

Provide sanitized typed purchase readiness covering deployment, edition implementation, sponsorship eligibility, account authority, configuration, and pending purchase state.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F019).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Provide sanitized typed purchase readiness covering deployment, edition implementation, sponsorship eligibility, account authority, configuration, and pending purchase state. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:F020

Status: `implemented-unverified`.

Load relationship management independently of billing readiness and keep usable licensed operations available during provider/configuration failures.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F020).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Load relationship management independently of billing readiness and keep usable licensed operations available during provider/configuration failures. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:F021

Status: `implemented-unverified`.

Compute a client allocation shortfall from refreshed capacity and review the resulting absolute sponsor pool target with provider-supplied recurring and due-now amounts.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F021).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Compute a client allocation shortfall from refreshed capacity and review the resulting absolute sponsor pool target with provider-supplied recurring and due-now amounts. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:F022

Status: `implemented-unverified`.

Invalidate stale previews and freeze submitted purchase operation identity/quantity across lost responses, client navigation, and pending purchases started elsewhere.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F022).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Invalidate stale previews and freeze submitted purchase operation identity/quantity across lost responses, client navigation, and pending purchases started elsewhere. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:F023

Status: `implemented-unverified`.

Distinguish checkout success, verified entitlement, and client allocation completion; recover expired/failed/uncertain purchases and allocation races without duplicate payment or implicit refund.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F023).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Distinguish checkout success, verified entitlement, and client allocation completion; recover expired/failed/uncertain purchases and allocation races without duplicate payment or implicit refund. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:F024

Status: `implemented-unverified`.

Preserve expiring session-scoped client drafts and validated relative return navigation through account/license management while keeping secrets and authorization out of draft storage.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F024).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Preserve expiring session-scoped client drafts and validated relative return navigation through account/license management while keeping secrets and authorization out of draft storage. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:F025

Status: `implemented-unverified`.

Move full hosted pool editing and pending recovery into Account Management using the same purchase controller; route self-host capacity changes through License Management.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F025).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Move full hosted pool editing and pending recovery into Account Management using the same purchase controller; route self-host capacity changes through License Management. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:F026

Status: `implemented-unverified`.

Implement all purchase degradation outcomes, including relationship-only/account-only roles, invalid signed claims, CE stubs, missing provider keys/price, and unusable embedded checkout.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F026).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Implement all purchase degradation outcomes, including relationship-only/account-only roles, invalid signed claims, CE stubs, missing provider keys/price, and unusable embedded checkout. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:F027

Status: `implemented-unverified`.

Make the global overview an authorized searchable/paginated client/workspace status and usage table with independent pool visibility and no restricted-client count inference.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F027).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Make the global overview an authorized searchable/paginated client/workspace status and usage table with independent pool visibility and no restricted-client count inference. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F028

Status: `implemented-unverified`.

Replace duplicate global setup/edit ownership with canonical client-section navigation and retain working/oversight, task, and archive entry points.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F028).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Replace duplicate global setup/edit ownership with canonical client-section navigation and retain working/oversight, task, and archive entry points. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:F029

Status: `implemented-unverified`.

Integrate a sponsor-client filter into combined ticket reads/counts/export and the client Tickets composition, matching native client records and authorized shared relationships before pagination.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F029).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Integrate a sponsor-client filter into combined ticket reads/counts/export and the client Tickets composition, matching native client records and authorized shared relationships before pagination. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## clientIntegration:F030

Status: `implemented-unverified`.

Provide client-context shared project/task navigation while preserving MSP-shell operation, qualified identities, and the existing native client experience when feature UI is unavailable.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F030).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Provide client-context shared project/task navigation while preserving MSP-shell operation, qualified identities, and the existing native client experience when feature UI is unavailable. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## clientIntegration:F031

Status: `implemented-unverified`.

Apply the original T21 boundary to every relocated summary, descriptor, deep link, management section, portal dialog, checkout/account editor, combined work control, and legacy adapter while preserving T22 backend independence.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F031).

Implementation: `server/src/components/co-managed/CoManagedFeatureBoundary.tsx`, `server/src/app/msp/MspLayoutClient.tsx`.

Regression locations: `server/src/test/unit/product/coManagedFeatureBoundary.test.tsx`, `server/src/test/unit/product/coManagedT21Boundary.contract.test.ts`.

Still required: Apply the original T21 boundary to every relocated summary, descriptor, deep link, management section, portal dialog, checkout/account editor, combined work control, and legacy adapter while preserving T22 backend independence. Complete real flag-off/direct-route/portal and backend-authority matrix; ordinary PSA/AlgaDesk fallback must remain usable.

## clientIntegration:F032

Status: `implemented-unverified`.

Complete translated labels/errors, keyboard and focus behavior, narrow layout, light/dark presentation, and affected CE/EE composition/build compatibility for the new surfaces.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F032).

Implementation: `server/src/components/co-managed/QualifiedTicketList.tsx`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedTicketSection.tsx`.

Regression locations: `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`.

Still required: Complete translated labels/errors, keyboard and focus behavior, narrow layout, light/dark presentation, and affected CE/EE composition/build compatibility for the new surfaces. Complete translated light/dark/narrow/keyboard/focus browser acceptance and retain the required revision-specific evidence.

## clientIntegration:F033

Status: `implemented-unverified`.

Record revision-specific component, migrated-database, hosted/self-host browser, and provider evidence with explicit pending/blocked dependencies and update original plan, flag docs, and audit addenda.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/features.json` (F033).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Record revision-specific component, migrated-database, hosted/self-host browser, and provider evidence with explicit pending/blocked dependencies and update original plan, flag docs, and audit addenda. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T001

Status: `implemented-unverified`.

Migrated DB: resolve a permitted sponsor-local client to its exact qualified relationship and persisted operation, return status/usage without global-page filtering, and retain customer-home policy behavior.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T001).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrated DB: resolve a permitted sponsor-local client to its exact qualified relationship and persisted operation, return status/usage without global-page filtering, and retain customer-home policy behavior. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T002

Status: `implemented-unverified`.

Migrated DB guard matrix: reject foreign client/operation/relationship combinations, unauthorized local client or escalation-board policy, forged browser identity/API overrides, and revoked sessions without leaking labels or counts; verify redaction of authorized reads.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T002).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrated DB guard matrix: reject foreign client/operation/relationship combinations, unauthorized local client or escalation-board policy, forged browser identity/API overrides, and revoked sessions without leaking labels or counts; verify redaction of authorized reads. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T003

Status: `implemented-unverified`.

Migrated DB: exercise absent, single, multiple, ended, and inconsistent mappings; require explicit selection for ambiguity, retain ended history, and reject a stale write after the selected mapping/relationship changes instead of targeting the new default.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T003).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrated DB: exercise absent, single, multiple, ended, and inconsistent mappings; require explicit selection for ambiguity, retain ended history, and reject a stale write after the selected mapping/relationship changes instead of targeting the new default. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T004

Status: `implemented-unverified`.

Migrated DB concurrency: race client Enable submissions with different operation IDs and prove one current setup; replay the original operation; preserve pre-existing multiple relationships; allow deliberate setup only after acknowledged cleanup or prior relationship closure. Exercise changed locking/index paths on Citus.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T004).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrated DB concurrency: race client Enable submissions with different operation IDs and prove one current setup; replay the original operation; preserve pre-existing multiple relationships; allow deliberate setup only after acknowledged cleanup or prior relationship closure. Exercise changed locking/index paths on Citus. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T005

Status: `implemented-unverified`.

Action and migrated DB regression: policy read/search/save, SLA read/save, delegation, departure, allocation, retry/cancel/resend resolve the same selected client relationship and preserve independent command identities, revisions, customer grants, and retained-history authority.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T005).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Action and migrated DB regression: policy read/search/save, SLA read/save, delegation, departure, allocation, retry/cancel/resend resolve the same selected client relationship and preserve independent command identities, revisions, customer grants, and retained-history authority. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T006

Status: `implemented-unverified`.

Migrated DB: client usage matches active technician plus distinct unexpired invitation reservation counts; exclude portal contacts/MSP technicians, deny a reduction below commitment, and retain existing allocation/race/lapse guards with expected seats.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T006).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrated DB: client usage matches active technician plus distinct unexpired invitation reservation counts; exclude portal contacts/MSP technicians, deny a reduction below commitment, and retain existing allocation/race/lapse guards with expected seats. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T007

Status: `implemented-unverified`.

Client composition: verify injected summary and co-managed Service focus view, full drawer tab, and quick-view full-client link. Parameterize original T21 disabled/loading/unknown/error states and unsupported/denied products; assert no feature calls or controls and working ordinary client content. Do not test only the boundary primitive.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T007).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Client composition: verify injected summary and co-managed Service focus view, full drawer tab, and quick-view full-client link. Parameterize original T21 disabled/loading/unknown/error states and unsupported/denied products; assert no feature calls or controls and working ordinary client content. Do not test only the boundary primitive. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T008

Status: `implemented-unverified`.

Client composition transitions: delayed flag/permission resolution consumes a direct co-managed deep link once; client/relationship switches discard stale responses; simultaneous page/drawer IDs are unique; draft dismissal is guarded. Disable the flag with setup and portaled checkout open, resolve late promises, and prove dialogs/reads do not restart.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T008).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Client composition transitions: delayed flag/permission resolution consumes a direct co-managed deep link once; client/relationship switches discard stale responses; simultaneous page/drawer IDs are unique; draft dismissal is guarded. Disable the flag with setup and portaled checkout open, resolve late promises, and prove dialogs/reads do not restart. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T009

Status: `implemented-unverified`.

Client management journey: fixed-client setup shows reserved progress then pending acceptance, reopens the original operation after failure/reload, distinguishes invitation expiry from delivery failure, and refreshes summary/usage after allocation or recovery. Active settings use embeddable sections and ended state uses retained history.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T009).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Client management journey: fixed-client setup shows reserved progress then pending acceptance, reopens the original operation after failure/reload, distinguishes invitation expiry from delivery failure, and refreshes summary/usage after allocation or recovery. Active settings use embeddable sections and ended state uses retained history. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T010

Status: `implemented-unverified`.

Parameterize purchase availability: both permissions, relationship-only, account-only, read-only, ineligible sponsor, hosted missing/invalid configuration, unavailable provider, CE stubs, and valid/missing/expired self-host claims. Assert correct recovery action, no unauthorized billing call/secret, and relationship reads usable despite billing failure.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T010).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Parameterize purchase availability: both permissions, relationship-only, account-only, read-only, ineligible sponsor, hosted missing/invalid configuration, unavailable provider, CE stubs, and valid/missing/expired self-host claims. Assert correct recovery action, no unauthorized billing call/secret, and relationship reads usable despite billing failure. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T011

Status: `implemented-unverified`.

Purchase review: cover creation and resizing, sufficient capacity with no charge, shortfall converted to an absolute pool target, active-seat floor, provider due-now/recurring totals, changed pool baseline, invalid quantity, and stale preview invalidation. Never pass client allocation or delta as total pool quantity.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T011).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Purchase review: cover creation and resizing, sufficient capacity with no charge, shortfall converted to an absolute pool target, active-seat floor, provider due-now/recurring totals, changed pool baseline, invalid quantity, and stale preview invalidation. Never pass client allocation or delta as total pool quantity. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T012

Status: `implemented-unverified`.

Migrated DB purchase/allocation recovery: pending purchase from another client blocks growth; repeated/lost responses retain one purchase operation and immutable quantity; success waits for verified entitlement; competing allocation after purchase yields a recoverable client error with seats retained in the pool and no second charge/refund.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T012).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrated DB purchase/allocation recovery: pending purchase from another client blocks growth; repeated/lost responses retain one purchase operation and immutable quantity; success waits for verified entitlement; competing allocation after purchase yields a recoverable client error with seats retained in the pool and no second charge/refund. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T013

Status: `implemented-unverified`.

Checkout recovery matrix: missing publishable key, SDK failure, embedded error, timeout, decline, user closure, terminal expiry, and delayed reconciliation each preserve the correct draft/pending state. Only acknowledged terminal expiry permits a new operation; disabling UI does not cancel a submitted purchase.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T013).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Checkout recovery matrix: missing publishable key, SDK failure, embedded error, timeout, decline, user closure, terminal expiry, and delayed reconciliation each preserve the correct draft/pending state. Only acknowledged terminal expiry permits a new operation; disabling UI does not cancel a submitted purchase. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T014

Status: `implemented-unverified`.

Account/license return: hosted full pool editor and contextual shortfall share recovery logic; self-host shortfalls route to License Management. Validate relative client return targets, session/client draft isolation, expiry/logout cleanup, no stored payment/invitation secrets, and server recovery after reload.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T014).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Account/license return: hosted full pool editor and contextual shortfall share recovery logic; self-host shortfalls route to License Management. Validate relative client return targets, session/client draft isolation, expiry/logout cleanup, no stored payment/invitation secrets, and server recovery after reload. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T015

Status: `implemented-unverified`.

Migrated DB plus overview component: authorized client/workspace rows, search/sort/count/pagination, ended/setup exceptions, and redacted usage remain consistent; account-only versus relationship-only readers get independent permitted sections; global actions navigate to the exact client relationship rather than duplicate dialogs.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T015).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrated DB plus overview component: authorized client/workspace rows, search/sort/count/pagination, ended/setup exceptions, and redacted usage remain consistent; account-only versus relationship-only readers get independent permitted sections; global actions navigate to the exact client relationship rather than duplicate dialogs. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T016

Status: `implemented-unverified`.

Migrated DB/client Tickets: one sponsor-client filter includes native and permitted shared work before paging/count/export, handles identical ticket IDs/numbers across tenants, excludes siblings/revoked relationships, and preserves working-versus-oversight semantics. Project/task links retain qualified identities; flag-off composition uses native client work only.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T016).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Migrated DB/client Tickets: one sponsor-client filter includes native and permitted shared work before paging/count/export, handles identical ticket IDs/numbers across tenants, excludes siblings/revoked relationships, and preserves working-versus-oversight semantics. Project/task links retain qualified identities; flag-off composition uses native client work only. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T017

Status: `implemented-unverified`.

Legacy route adapters: authorized operation-based policy/SLA/delegation/departure and client setup links land on the exact canonical client section; invalid/conflicting/foreign selectors reveal no client identity; customer-home and qualified work routes remain valid. T21 unavailable states perform no adapter discovery.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T017).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Legacy route adapters: authorized operation-based policy/SLA/delegation/departure and client setup links land on the exact canonical client section; invalid/conflicting/foreign selectors reveal no client identity; customer-home and qualified work routes remain valid. T21 unavailable states perform no adapter discovery. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T018

Status: `blocked-external`.

Hosted browser evidence at the implementation revision: client setup, real Stripe test-mode shortfall review/checkout/reconciliation, provisioning, customer-admin acceptance, client seat/settings management, overview return, and independent relationship/account roles. Include actual flag-off direct client/legacy URLs and native-client fallback; keep provider prerequisites explicit if blocked.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T018).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Hosted browser evidence at the implementation revision: client setup, real Stripe test-mode shortfall review/checkout/reconciliation, provisioning, customer-admin acceptance, client seat/settings management, overview return, and independent relationship/account roles. Include actual flag-off direct client/legacy URLs and native-client fallback; keep provider prerequisites explicit if blocked. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## clientIntegration:T019

Status: `blocked-external`.

Self-host browser evidence: use verified signed capacity, encounter shortfall, open License Management, update entitlement, and return to the preserved client draft; exercise missing/expired claims, ordinary client usability with UI off, and resumed pending work. Record real issuer availability separately from signed-fixture tests.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T019).

Implementation: `packages/licensing/src/lib/co-managed-license.ts`, `packages/licensing/src/lib/co-managed-entitlements.ts`.

Regression locations: `packages/licensing/src/lib/co-managed-license.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Self-host browser evidence: use verified signed capacity, encounter shortfall, open License Management, update entitlement, and return to the preserved client draft; exercise missing/expired claims, ordinary client usability with UI off, and resumed pending work. Record real issuer availability separately from signed-fixture tests. Exercise normal signed-license import/refresh and independent upgrade controls; raw entitlement fixtures alone do not satisfy the signed-license journey.

## clientIntegration:T020

Status: `implemented-unverified`.

Original T22 regression: while the client UI flag is off, authorized target resolution, management actions, and existing purchase/provisioning/reconciliation operate under normal product/license rules and unauthorized actors remain denied. Pair direct behavioral checks with review of release-key references; no backend flag checks are introduced.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T020).

Implementation: `packages/co-managed/src/managementPolicy.ts`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedClientView.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`, `server/src/test/unit/product/coManagedClientManagement.test.tsx`.

Still required: Original T22 regression: while the client UI flag is off, authorized target resolution, management actions, and existing purchase/provisioning/reconciliation operate under normal product/license rules and unauthorized actors remain denied. Pair direct behavioral checks with review of release-key references; no backend flag checks are introduced. Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.

## clientIntegration:T021

Status: `implemented-unverified`.

Affected CE/EE typecheck/build and browser presentation evidence: exercise full-page/drawer/narrow layouts, keyboard/focus return, light/dark and a translated locale; verify independent ordinary account/license surfaces with T21 off. Link executions and artifacts from dated original-plan/flag-doc/audit updates without converting blocked provider/browser cases into passes.

Specification: `docs/plans/2026-09-11-co-managed-client-integration/tests.json` (T021).

Implementation: `server/src/components/co-managed/QualifiedTicketList.tsx`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedTicketSection.tsx`.

Regression locations: `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`.

Still required: Affected CE/EE typecheck/build and browser presentation evidence: exercise full-page/drawer/narrow layouts, keyboard/focus return, light/dark and a translated locale; verify independent ordinary account/license surfaces with T21 off. Link executions and artifacts from dated original-plan/flag-doc/audit updates without converting blocked provider/browser cases into passes. Complete translated light/dark/narrow/keyboard/focus browser acceptance and retain the required revision-specific evidence.

## ticketList:F001

Status: `implemented-unverified`.

Add a shared discriminated ticket-list scope parser and serializer for working/oversight, This MSP/all/customer workspace, and qualified-only filter parameters.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F001).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Add a shared discriminated ticket-list scope parser and serializer for working/oversight, This MSP/all/customer workspace, and qualified-only filter parameters. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F002

Status: `implemented-unverified`.

Preserve native URLs and bare-route remembered-board/page-size behavior while making explicit qualified scope outrank native board/default restoration.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F002).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Preserve native URLs and bare-route remembered-board/page-size behavior while making explicit qualified scope outrank native board/default restoration. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F003

Status: `implemented-unverified`.

Keep a complete native list-state snapshot for source return and implement explicit source transitions, query reset, Back/Forward and navigation-in-flight URL guards.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F003).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Keep a complete native list-state snapshot for source return and implement explicit source transitions, query reset, Back/Forward and navigation-in-flight URL guards. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F004

Status: `implemented-unverified`.

Provide typed qualified row identity and stable table, selection, cache and automation keys without coercing foreign ticket IDs into the native ITicketListItem contract.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F004).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Provide typed qualified row identity and stable table, selection, cache and automation keys without coercing foreign ticket IDs into the native ITicketListItem contract. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F005

Status: `implemented-unverified`.

Create source-aware title/number link and row-navigation seams, preserving native prefetch and modified-click behavior for native and shared routes.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F005).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Create source-aware title/number link and row-navigation seams, preserving native prefetch and modified-click behavior for native and shared routes. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F006

Status: `implemented-unverified`.

Extend validated ticket-list return state so native and qualified detail routes can return to the originating combined view, filters and page.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F006).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Extend validated ticket-list return state so native and qualified detail routes can return to the originating combined view, filters and page. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F007

Status: `implemented-unverified`.

Project optional has_msp_assignment from existing qualified MSP references only when assignment fields are authorized, preserving omitted-versus-false semantics and working membership.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F007).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Project optional has_msp_assignment from existing qualified MSP references only when assignment fields are authorized, preserving omitted-versus-false semantics and working membership. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F008

Status: `implemented-unverified`.

Constrain qualified workspace options to the authorized selected client before search/state/pagination and preserve explicitly unavailable workspace selection without silent widening.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F008).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Constrain qualified workspace options to the authorized selected client before search/state/pagination and preserve explicitly unavailable workspace selection without silent widening. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F009

Status: `implemented-unverified`.

Retain one authorized relation for qualified rows, supported filters, sorts, state, total counts and full export, including native-plus-shared client matching and redaction.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F009).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Retain one authorized relation for qualified rows, supported filters, sorts, state, total counts and full export, including native-plus-shared client matching and redaction. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F010

Status: `implemented-unverified`.

Extract a presentational TicketListShell from the actual dashboard frame with heading/actions, scope, board, toolbar and results slots while preserving native structure and IDs.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F010).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Extract a presentational TicketListShell from the actual dashboard frame with heading/actions, scope, board, toolbar and results slots while preserving native structure and IDs. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F011

Status: `implemented-unverified`.

Add an app-owned coordinator and package-safe composition slots that mount one active native or qualified controller without reverse app imports.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F011).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Add an app-owned coordinator and package-safe composition slots that mount one active native or qualified controller without reverse app imports. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F012

Status: `implemented-unverified`.

Handle explicit qualified SSR entry with correct loading and client-gated loading of feature data, while providing native fallback independently of discarded native metadata/filter queries.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F012).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Handle explicit qualified SSR entry with correct loading and client-gated loading of feature data, while providing native fallback independently of discarded native metadata/filter queries. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F013

Status: `implemented-unverified`.

Render visible Working queue/Customer oversight controls and workspace selection in the existing dashboard hierarchy, replacing the separate co-managed queue link.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F013).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Render visible Working queue/Customer oversight controls and workspace selection in the existing dashboard hierarchy, replacing the separate co-managed queue link. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F014

Status: `implemented-unverified`.

Retain native board tabs/header/stats, pinned and transient boards, board-scoped statuses, complete native filters/chips, bundles and indexed comment search in This MSP.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F014).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Retain native board tabs/header/stats, pinned and transient boards, board-scoped statuses, complete native filters/chips, bundles and indexed comment search in This MSP. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F015

Status: `implemented-unverified`.

Retain native metadata, client quick view, inline tags, bundle identity, assignments, response-state and Due/SLA cell behavior without running native enrichment for qualified rows.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F015).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Retain native metadata, client quick view, inline tags, bundle identity, assignments, response-state and Due/SLA cell behavior without running native enrichment for qualified rows. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F016

Status: `implemented-unverified`.

Add optional DataTable auto-versus-scroll fitting with unchanged native auto-fit defaults and an opt-in qualified scroll mode that retains identity and responsibility columns.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F016).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Add optional DataTable auto-versus-scroll fitting with unchanged native auto-fit defaults and an opt-in qualified scroll mode that retains identity and responsibility columns. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F017

Status: `implemented-unverified`.

Preserve native View column order/density and board/tenant default capture/reset, keeping qualified scope and display state out of native saved-default writes.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F017).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Preserve native View column order/density and board/tenant default capture/reset, keeping qualified scope and display state out of native saved-default writes. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F018

Status: `implemented-unverified`.

Refactor the standalone qualified queue presentation to use the existing list shell, shared UI controls and DataTable with typed rows.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F018).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Refactor the standalone qualified queue presentation to use the existing list shell, shared UI controls and DataTable with typed rows. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F019

Status: `implemented-unverified`.

Render qualified title/number/workspace identity, canonical status/priority, responsible organization, updated date and authorized MSP-assignment explanation with restricted-field fallbacks.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F019).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Render qualified title/number/workspace identity, canonical status/priority, responsible organization, updated date and authorized MSP-assignment explanation with restricted-field fallbacks. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F020

Status: `implemented-unverified`.

Provide qualified client/workspace/open-closed-all filters and applied title/number search using authorized options, explicit search semantics and scope-preserving reset.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F020).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Provide qualified client/workspace/open-closed-all filters and applied title/number search using authorized options, explicit search semantics and scope-preserving reset. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F021

Status: `implemented-unverified`.

Wire qualified supported sorting and direction, server pagination, valid existing page-size preference, range/total and refresh without unsupported header sorting or misleading state counts.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F021).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Wire qualified supported sorting and direction, server pagination, valid existing page-size preference, range/total and refresh without unsupported header sorting or misleading state counts. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F022

Status: `implemented-unverified`.

Provide qualified View controls for supported optional columns and density while keeping title/workspace and responsibility mandatory and avoiding a personal saved-view subsystem.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F022).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Provide qualified View controls for supported optional columns and density while keeping title/workspace and responsibility mandatory and avoiding a personal saved-view subsystem. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F023

Status: `implemented-unverified`.

Isolate request generations, caches, applied filters and export lifetimes by actor and qualified scope, canceling inactive source effects and rejecting stale responses after navigation or teardown.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F023).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Isolate request generations, caches, applied filters and export lifetimes by actor and qualified scope, canceling inactive source effects and rejecting stale responses after navigation or teardown. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F024

Status: `implemented-unverified`.

Expose full filtered qualified CSV through the existing Share area, independent of handback selection, preserving machine-readable owner/relationship/ticket columns and native Share behavior.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F024).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Expose full filtered qualified CSV through the existing Share area, independent of handback selection, preserving machine-readable owner/relationship/ticket columns and native Share behavior. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F025

Status: `implemented-unverified`.

Use the existing routed creation form and shortcut with Add MSP ticket wording and authorized client prefill in qualified mode, refreshing without silently changing ownership or current scope.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F025).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Use the existing routed creation form and shortcut with Add MSP ticket wording and authorized client prefill in qualified mode, refreshing without silently changing ownership or current scope. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F026

Status: `implemented-unverified`.

Provide a success link when an MSP-created ticket is outside the current qualified view instead of inserting it into customer-only results or switching scope implicitly.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F026).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Provide a success link when an MSP-created ticket is outside the current qualified view instead of inserting it into customer-only results or switching scope implicitly. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F027

Status: `implemented-unverified`.

Keep qualified selection separate from TicketsRouteProvider local-ID persistence and native all-matching/bulk routes; clear incompatible selections on source transitions.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F027).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Keep qualified selection separate from TicketsRouteProvider local-ID persistence and native all-matching/bulk routes; clear incompatible selections on source transitions. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:F028

Status: `implemented-unverified`.

Integrate current-page eligible shared-row handback selection with one action bar/composer and remove the duplicate standalone bulk-handback checklist.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F028).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Integrate current-page eligible shared-row handback selection with one action bar/composer and remove the duplicate standalone bulk-handback checklist. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F029

Status: `implemented-unverified`.

Preserve required shared-note audience, qualified resources, per-item expected revisions and immutable operation IDs through submission and same-command uncertain retries.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F029).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Preserve required shared-note audience, qualified resources, per-item expected revisions and immutable operation IDs through submission and same-command uncertain retries. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F030

Status: `implemented-unverified`.

Prevent scope/page changes or another composer from replacing unresolved handback intent; persist the exact request before submission for actor-qualified session recovery with expiry/logout cleanup and a same-session fallback when storage is unavailable.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F030).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Prevent scope/page changes or another composer from replacing unresolved handback intent; persist the exact request before submission for actor-qualified session recovery with expiry/logout cleanup and a same-session fallback when storage is unavailable. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F031

Status: `implemented-unverified`.

Display per-item handback outcomes and re-read the authorized queue after completion so returned work leaves working when appropriate and remains in oversight without duplication.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F031).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Display per-item handback outcomes and re-read the authorized queue after completion so returned work leaves working when appropriate and remains in oversight without duplication. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F032

Status: `implemented-unverified`.

Provide qualified loading/empty/no-match/unavailable/restricted/retry states and clear stale rows/counts on failed authorization-sensitive reads or unclassified export errors.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F032).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Provide qualified loading/empty/no-match/unavailable/restricted/retry states and clear stale rows/counts on failed authorization-sensitive reads or unclassified export errors. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F033

Status: `implemented-unverified`.

Reuse the new qualified list body in the client integration ticketsContent slot with fixed client identity, embedded layout and instance-specific automation IDs.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F033).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Reuse the new qualified list body in the client integration ticketsContent slot with fixed client identity, embedded layout and instance-specific automation IDs. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F034

Status: `implemented-unverified`.

Preserve native MspClientTickets cursor/drawer/create behavior when shared client composition is absent and include all authorized client relationships when it is present.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F034).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Preserve native MspClientTickets cursor/drawer/create behavior when shared client composition is absent and include all authorized client relationships when it is present. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F035

Status: `implemented-unverified`.

Move co-managed work entry links to explicit canonical ticket-list scopes and replace the old dedicated queue route with a client-gated compatibility adapter using the same route contract.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F035).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Move co-managed work entry links to explicit canonical ticket-list scopes and replace the old dedicated queue route with a client-gated compatibility adapter using the same route contract. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F036

Status: `implemented-unverified`.

Apply inherited T21 to scope controls, shared controllers and portaled dialogs, retaining native fallback for disabled/loading/unknown/error states without stale remounts or feature reads.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F036).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Apply inherited T21 to scope controls, shared controllers and portaled dialogs, retaining native fallback for disabled/loading/unknown/error states without stale remounts or feature reads. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F037

Status: `implemented-unverified`.

Keep sponsor PSA eligibility distinct from AlgaDesk/customer product paths and preserve T22 authorization and backend behavior independently of the UI release flag.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F037).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Keep sponsor PSA eligibility distinct from AlgaDesk/customer product paths and preserve T22 authorization and backend behavior independently of the UI release flag. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F038

Status: `implemented-unverified`.

Integrate translations, existing theme tokens, keyboard navigation/focus return and narrow-width behavior with shared primitives and without replacing application chrome.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F038).

Implementation: `server/src/components/co-managed/QualifiedTicketList.tsx`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedTicketSection.tsx`.

Regression locations: `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`.

Still required: Integrate translations, existing theme tokens, keyboard navigation/focus return and narrow-width behavior with shared primitives and without replacing application chrome. Complete translated light/dark/narrow/keyboard/focus browser acceptance and retain the required revision-specific evidence.

## ticketList:F039

Status: `implemented-unverified`.

Retire duplicate qualified list ownership only after global, client and legacy entries use the common composition and record real application evidence distinct from prototype checks.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F039).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Retire duplicate qualified list ownership only after global, client and legacy entries use the common composition and record real application evidence distinct from prototype checks. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F040

Status: `implemented-unverified`.

Add the Customer Tickets page at /msp/tickets/customer with its own heading, release-boundary-gated loading and qualified list body; parse queueView/workspace/clientId and qualified presentation parameters, rejecting workspace=msp.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F040).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Add the Customer Tickets page at /msp/tickets/customer with its own heading, release-boundary-gated loading and qualified list body; parse queueView/workspace/clientId and qualified presentation parameters, rejecting workspace=msp. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F041

Status: `implemented-unverified`.

Redirect /msp/tickets?queueView=… to /msp/tickets/customer with supported parameters (workspace=msp or no queueView lands on native /msp/tickets); retarget /msp/co-managed/tickets and all co-managed work links to the new route.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F041).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Redirect /msp/tickets?queueView=… to /msp/tickets/customer with supported parameters (workspace=msp or no queueView lands on native /msp/tickets); retarget /msp/co-managed/tickets and all co-managed work links to the new route. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F042

Status: `implemented-unverified`.

Restore All Tickets to main behaviour: remove scopeControls content and the qualified branch from /msp/tickets, keeping co-managed state out of native URL, filters and saved View defaults.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F042).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Restore All Tickets to main behaviour: remove scopeControls content and the qualified branch from /msp/tickets, keeping co-managed state out of native URL, filters and saved View defaults. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F043

Status: `implemented-unverified`.

Give Customer Tickets the native toolbar vocabulary: search field, collapsible Filters holding workspace/client/open-closed-all, View (supported columns and density), Share (full filtered CSV); extract shared presentational pieces from the dashboard and delete TicketListShell if unused.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F043).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Give Customer Tickets the native toolbar vocabulary: search field, collapsible Filters holding workspace/client/open-closed-all, View (supported columns and density), Share (full filtered CSV); extract shared presentational pieces from the dashboard and delete TicketListShell if unused. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F044

Status: `implemented-unverified`.

Remove native home-tenant tickets from the qualified ticket reader working view so rows, counts, workspace options and CSV contain shared tickets only; leave the task reader unchanged.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F044).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Remove native home-tenant tickets from the qualified ticket reader working view so rows, counts, workspace options and CSV contain shared tickets only; leave the task reader unchanged. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F045

Status: `implemented-unverified`.

Add authorized reader filters and counts for the two callout signals (escalated-unassigned; assigned to me/my team with response_state awaiting_internal), excluding rows whose driving fields are redacted.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F045).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Add authorized reader filters and counts for the two callout signals (escalated-unassigned; assigned to me/my team with response_state awaiting_internal), excluding rows whose driving fields are redacted. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F046

Status: `implemented-unverified`.

Render the All Tickets callout strip and the Customer Tickets menu badge from the signal counts: lazy after native render, silent on error/empty, deep links with matching filters, per-viewer dismissal until a count increases.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F046).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Render the All Tickets callout strip and the Customer Tickets menu badge from the signal counts: lazy after native render, silent on error/empty, deep links with matching filters, per-viewer dismissal until a count increases. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F047

Status: `implemented-unverified`.

Keep the native MspClientTickets list on the client Tickets tab; show the shared-only qualified list with fixed client in the client co-managed section and a client-scoped callout strip on the Tickets tab.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F047).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Keep the native MspClientTickets list on the client Tickets tab; show the shared-only qualified list with fixed client in the client co-managed section and a client-scoped callout strip on the Tickets tab. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F048

Status: `implemented-unverified`.

Regroup navigation: Tickets (All, Customer, Recurring), Projects (All, Shared Tasks, Templates), one Co-managed IT group (Overview, Delegated administration, customer-side Co-managed access).

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F048).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Regroup navigation: Tickets (All, Customer, Recurring), Projects (All, Shared Tasks, Templates), one Co-managed IT group (Overview, Delegated administration, customer-side Co-managed access). Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:F049

Status: `implemented-unverified`.

Gate Customer Tickets, Shared Tasks, callouts and badge on release flag + sponsoring PSA Pro + at least one active staff-assigned relationship; show PSA Delegated administration only when the user has current delegated approvals.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/features.json` (F049).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Gate Customer Tickets, Shared Tasks, callouts and badge on release flag + sponsoring PSA Pro + at least one active staff-assigned relationship; show PSA Delegated administration only when the user has current delegated approvals. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T001

Status: `implemented-unverified`.

Unit-test scope parsing/serialization and precedence: native bare/filter/return URLs retain behavior, explicit qualified scope defeats remembered boards, malformed values do not widen authority, oversight excludes This MSP, and page sizes normalize within supported limits.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T001).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Unit-test scope parsing/serialization and precedence: native bare/filter/return URLs retain behavior, explicit qualified scope defeats remembered boards, malformed values do not widen authority, oversight excludes This MSP, and page sizes normalize within supported limits. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T002

Status: `implemented-unverified`.

Exercise native-to-qualified-to-native transitions and browser history on the real coordinator, retaining native board/filter/bundle/view snapshots, clearing incompatible selection, and proving URL writers stop before ticket/create navigation.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T002).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Exercise native-to-qualified-to-native transitions and browser history on the real coordinator, retaining native board/filter/bundle/view snapshots, clearing incompatible selection, and proving URL writers stop before ticket/create navigation. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:T003

Status: `implemented-unverified`.

Use the migrated co-managed database harness to query native plus two customer workspaces mapped to one client with same-number/same-UUID records; assert working/oversight membership, assignment-only inclusion, ordering, page totals, client-scoped workspace options and full filtered export.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T003).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Use the migrated co-managed database harness to query native plus two customer workspaces mapped to one client with same-number/same-UUID records; assert working/oversight membership, assignment-only inclusion, ordering, page totals, client-scoped workspace options and full filtered export. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T004

Status: `implemented-unverified`.

Run real database guard cases for revoked scope/ended relationship, sibling-client exclusion and redacted assignment/responsibility/title. Assert no hidden membership, option labels, counts, search matches or assignment booleans leak, and omitted assignment differs from false.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T004).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Run real database guard cases for revoked scope/ended relationship, sibling-client exclusion and redacted assignment/responsibility/title. Assert no hidden membership, option labels, counts, search matches or assignment booleans leak, and omitted assignment differs from false. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T005

Status: `implemented-unverified`.

Render the native dashboard through the new frame and retain representative board tabs/default arrivals, native filter chips, indexed-comment search request, bundle expansion, metadata and client quick view; run existing board/view/column-prefetch regressions.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T005).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Render the native dashboard through the new frame and retain representative board tabs/default arrivals, native filter chips, indexed-comment search request, bundle expansion, metadata and client quick view; run existing board/view/column-prefetch regressions. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:T006

Status: `implemented-unverified`.

Test DataTable default auto-fit/hidden-column notice and opt-in scroll side by side. Confirm qualified identity/responsibility remain reachable with long titles and source names while other table consumers retain default fitting.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T006).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Test DataTable default auto-fit/hidden-column notice and opt-in scroll side by side. Confirm qualified identity/responsibility remain reachable with long titles and source names while other table consumers retain default fitting. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T007

Status: `implemented-unverified`.

Test qualified toolbar requests for applied title/number search, client/workspace/state, supported sorting, reset and pagination; assert unsupported native controls/loaders are absent and counts/options derive from server results rather than the displayed page.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T007).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Test qualified toolbar requests for applied title/number search, client/workspace/state, supported sorting, reset and pagination; assert unsupported native controls/loaders are absent and counts/options derive from server results rather than the displayed page. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T008

Status: `implemented-unverified`.

Exercise the Customer Tickets View controls: limit qualified options to supported fields, keep identity/responsibility fixed and prove qualified state never writes native board/tenant defaults. The native half is "All Tickets matches main": the native dashboard differs from origin/main only by the listCallout slot and the legacy queueView redirect.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T008).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Exercise the Customer Tickets View controls: limit qualified options to supported fields, keep identity/responsibility fixed and prove qualified state never writes native board/tenant defaults. The native half is "All Tickets matches main": the native dashboard differs from origin/main only by the listCallout slot and the legacy queueView redirect. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

Approved amendment: docs/plans/2026-09-11-co-managed-ticket-list-unification/PRD.md#decision-amendment--2026-10-14: assess this retained ID under D1-D4/A1-A8, not the superseded two-source shell/snapshot design.

## ticketList:T009

Status: `implemented-unverified`.

Exercise duplicate ticket identities through table rows, title links, number links, Ctrl/Cmd opening and detail returns. Assert every path selects the correct native/qualified route and no foreign ID enters native tag/avatar/board/detail loaders.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T009).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Exercise duplicate ticket identities through table rows, title links, number links, Ctrl/Cmd opening and detail returns. Assert every path selects the correct native/qualified route and no foreign ID enters native tag/avatar/board/detail loaders. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T010

Status: `implemented-unverified`.

Exercise Share on Customer Tickets: qualified CSV exports all applied matches regardless of page or handback selection, stale downloads are suppressed and a failed unclassified/denied export clears protected rows/counts. The native half is "All Tickets matches main" (native selected export/import/print untouched).

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T010).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Exercise Share on Customer Tickets: qualified CSV exports all applied matches regardless of page or handback selection, stale downloads are suppressed and a failed unclassified/denied export clears protected rows/counts. The native half is "All Tickets matches main" (native selected export/import/print untouched). Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T011

Status: `implemented-unverified`.

Open the existing create-ticket route by button and shortcut from a customer workspace/client scope, verify explicit MSP ownership and authorized local-client prefill, and confirm success outside the current scope offers a native detail link without changing the queue implicitly.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T011).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Open the existing create-ticket route by button and shortcut from a customer workspace/client scope, verify explicit MSP ownership and authorized local-client prefill, and confirm success outside the current scope offers a native detail link without changing the queue implicitly. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T012

Status: `implemented-unverified`.

Test qualified page selection and handback eligibility, required note/audience, 100-item bound and single composer; verify native records and customer-responsible assignment-only records cannot enter handback or native bulk modal selection through this surface.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T012).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Test qualified page selection and handback eligibility, required note/audience, 100-item bound and single composer; verify native records and customer-responsible assignment-only records cannot enter handback or native bulk modal selection through this surface. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T013

Status: `implemented-unverified`.

Simulate a handback timeout after partial processing, then same-batch retry, reload and actor-scoped recovery. Assert operation/resource/revision/note immutability, blocked replacement by scope/page/another composer, no auto-submit after remount, cleanup or rejection for changed actor/expired saved intent, and same-session recovery when storage fails.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T013).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Simulate a handback timeout after partial processing, then same-batch retry, reload and actor-scoped recovery. Assert operation/resource/revision/note immutability, blocked replacement by scope/page/another composer, no auto-submit after remount, cleanup or rejection for changed actor/expired saved intent, and same-session recovery when storage fails. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T014

Status: `implemented-unverified`.

Run real database handback with successful, stale-revision and forbidden/read-only items; retry the exact request and verify one receipt/handoff per successful resource, per-item results, canonical ownership and re-queried working/oversight membership.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T014).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Run real database handback with successful, stale-revision and forbidden/read-only items; retry the exact request and verify one receipt/handoff per successful resource, per-item results, canonical ownership and re-queried working/oversight membership. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T015

Status: `implemented-unverified`.

Parameterize delayed native/qualified reads, export and list failures, empty results and unavailable workspace selection; prove old rows/counts/options never overwrite a changed scope and reset/retry does not silently escape an explicit workspace or fixed client.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T015).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Parameterize delayed native/qualified reads, export and list failures, empty results and unavailable workspace selection; prove old rows/counts/options never overwrite a changed scope and reset/retry does not silently escape an explicit workspace or fixed client. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T016

Status: `implemented-unverified`.

Exercise actual client ticketsContent composition in full-page and drawer instances with one local client mapping to multiple workspaces; retain fixed-client reads/export/reset and unique IDs, while unavailable/no-relationship cases keep native cursor/drawer/create behavior.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T016).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Exercise actual client ticketsContent composition in full-page and drawer instances with one local client mapping to multiple workspaces; retain fixed-client reads/export/reset and unique IDs, while unavailable/no-relationship cases keep native cursor/drawer/create behavior. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T017

Status: `implemented-unverified`.

Parameterize inherited UI boundary states on the new coordinator/client slots and legacy adapter, including turning off during load/export/handback and late promise completion; assert shared UI/portals/queries disappear and native work stays usable with no stale remount or fresh retry identity.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T017).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Parameterize inherited UI boundary states on the new coordinator/client slots and legacy adapter, including turning off during load/export/handback and late promise completion; assert shared UI/portals/queries disappear and native work stays usable with no stale remount or fresh retry identity. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T018

Status: `implemented-unverified`.

Verify sponsor PSA, AlgaDesk and co-managed customer composition plus legacy/canonical URLs; retain backend authorized/denied action behavior with the UI flag off and ensure compatibility navigation introduces no flag-dependent backend redirect or permission bypass.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T018).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Verify sponsor PSA, AlgaDesk and co-managed customer composition plus legacy/canonical URLs; retain backend authorized/denied action behavior with the UI flag off and ensure compatibility navigation introduces no flag-dependent backend redirect or permission bypass. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T019

Status: `implemented-unverified`.

Run a real application browser journey: All Tickets callout, Customer Tickets (working), customer oversight, client narrowing, duplicate-identity opening/return, handback and All Tickets again; inspect desktop/narrow widths, one translated locale, light/dark and keyboard/focus behaviour. All Tickets itself must match main.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T019).

Implementation: `server/src/components/co-managed/QualifiedTicketList.tsx`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedTicketSection.tsx`.

Regression locations: `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`.

Still required: Run a real application browser journey: All Tickets callout, Customer Tickets (working), customer oversight, client narrowing, duplicate-identity opening/return, handback and All Tickets again; inspect desktop/narrow widths, one translated locale, light/dark and keyboard/focus behaviour. All Tickets itself must match main. Complete translated light/dark/narrow/keyboard/focus browser acceptance and retain the required revision-specific evidence.

## ticketList:T020

Status: `implemented-unverified`.

Run affected tickets/co-managed/UI/types/composition and server typechecks plus focused existing native selection/URL, table, qualified queue/action/handback and client-boundary suites; verify package export/build seams and record failures separately from unexecuted external dependencies.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T020).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Run affected tickets/co-managed/UI/types/composition and server typechecks plus focused existing native selection/URL, table, qualified queue/action/handback and client-boundary suites; verify package export/build seams and record failures separately from unexecuted external dependencies. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T021

Status: `implemented-unverified`.

Migrated-database cases: working view returns no native home tickets; each callout signal counts exactly the rows its filter lists; redacted responsibility/assignment/response_state excludes a row from the signal and the count; a user without staff assignment gets zero.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T021).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Migrated-database cases: working view returns no native home tickets; each callout signal counts exactly the rows its filter lists; redacted responsibility/assignment/response_state excludes a row from the signal and the count; a user without staff assignment gets zero. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T022

Status: `implemented-unverified`.

Route tests: /msp/tickets?queueView=… redirects to /msp/tickets/customer preserving supported parameters; workspace=msp and missing queueView land on native; /msp/co-managed/tickets and co-managed work links target the new route.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T022).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Route tests: /msp/tickets?queueView=… redirects to /msp/tickets/customer preserving supported parameters; workspace=msp and missing queueView land on native; /msp/co-managed/tickets and co-managed work links target the new route. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T023

Status: `implemented-unverified`.

Callout strip and badge: render nothing when the flag is off, loading, errored, zero or the user has no assignments; never delay or re-request the native list; dismissal hides until a count increases and survives unavailable storage; deep links carry the matching filter.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T023).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Callout strip and badge: render nothing when the flag is off, loading, errored, zero or the user has no assignments; never delay or re-request the native list; dismissal hides until a count increases and survives unavailable storage; deep links carry the matching filter. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T024

Status: `implemented-unverified`.

All Tickets renders with no scope bar and no co-managed URL/filter/View state (saved defaults unchanged); Customer Tickets toolbar exposes search, collapsible Filters, View and Share with only supported controls and no Bundled toggle or create action.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T024).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: All Tickets renders with no scope bar and no co-managed URL/filter/View state (saved defaults unchanged); Customer Tickets toolbar exposes search, collapsible Filters, View and Share with only supported controls and no Bundled toggle or create action. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T025

Status: `implemented-unverified`.

Navigation and client screens: menu grouping per A8; Customer Tickets/Shared Tasks hidden without a relevant relationship; PSA Delegated administration hidden with no approvals; client Tickets tab keeps native list and shows the client-scoped callout.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T025).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Navigation and client screens: menu grouping per A8; Customer Tickets/Shared Tasks hidden without a relevant relationship; PSA Delegated administration hidden with no approvals; client Tickets tab keeps native list and shows the client-scoped callout. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## ticketList:T026

Status: `implemented-unverified`.

Running application: technician sees the callout on All Tickets after a customer escalation, follows it to Customer Tickets with the filter applied, opens the shared ticket and returns; All Tickets keeps board strip, Filters, Bundled, View and Share unchanged.

Specification: `docs/plans/2026-09-11-co-managed-ticket-list-unification/tests.json` (T026).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Running application: technician sees the callout on All Tickets after a customer escalation, follows it to Customer Tickets with the filter applied, opens the shared ticket and returns; All Tickets keeps board strip, Filters, Bundled, View and Share unchanged. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## CF001

Status: `implemented-unverified`.

Reconcile every foundation and follow-on requirement into a source/evidence inventory, preserving open or stale statuses and the existing external-provider scope.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF001).

Implementation: `scripts/lib/co-managed-plan-ids.mjs`, `scripts/lib/co-managed-completion.mjs`, `scripts/build-co-managed-inventory.mjs`.

Regression locations: `scripts/tests/co-managed-plan-ids.test.mjs`, `scripts/tests/co-managed-completion.test.mjs`.

Still required: Reconcile every foundation and follow-on requirement into a source/evidence inventory, preserving open or stale statuses and the existing external-provider scope. Gate behavior is tested; actual-candidate acceptance cannot pass until every required evidence obligation is met. Do not relax the gate or convert a source census into acceptance.

## CF002

Status: `implemented-unverified`.

Capture the first requester intake error and reproducible CI/source/runtime/schema/order differences without recursive error serialization or secrets.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF002).

Implementation: `packages/co-managed/src/inboundRequesterReply.ts`, `shared/services/email/inboundEmailCoreProcessor.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Capture the first requester intake error and reproducible CI/source/runtime/schema/order differences without recursive error serialization or secrets. Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.

## CF003

Status: `implemented-unverified`.

Repair the demonstrated requester lifecycle cause so separately compiled admission pauses defer, roll back effects and refund claims while unknown failures retry.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF003).

Implementation: `packages/co-managed/src/inboundRequesterReply.ts`, `shared/services/email/inboundEmailCoreProcessor.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Repair the demonstrated requester lifecycle cause so separately compiled admission pauses defer, roll back effects and refund claims while unknown failures retry. Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.

## CF004

Status: `implemented-unverified`.

Preserve requester audience/token isolation, both worker entry points and exactly-once renewal replay through the deferral repair.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF004).

Implementation: `packages/co-managed/src/inboundRequesterReply.ts`, `shared/services/email/inboundEmailCoreProcessor.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Preserve requester audience/token isolation, both worker entry points and exactly-once renewal replay through the deferral repair. Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.

## CF005

Status: `implemented-unverified`.

Expose a customer-permitted provider setup composition with working Email/identity/directory links and return navigation while denying unrelated integration categories.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF005).

Implementation: `server/src/components/co-managed/CoManagedProviderSetup.tsx`, `server/src/lib/productSurfaceRegistry.ts`.

Regression locations: `server/src/test/unit/product/providerSetupReachability.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Expose a customer-permitted provider setup composition with working Email/identity/directory links and return navigation while denying unrelated integration categories. Complete customer-owned provider setup/save/reload/OAuth and directory vendor-event flow through normal controls and real consumers.

## CF006

Status: `implemented-unverified`.

Retain product/RBAC/tenant/secret admission on every customer provider configuration read, save and OAuth callback.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF006).

Implementation: `server/src/components/co-managed/CoManagedProviderSetup.tsx`, `server/src/lib/productSurfaceRegistry.ts`.

Regression locations: `server/src/test/unit/product/providerSetupReachability.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Retain product/RBAC/tenant/secret admission on every customer provider configuration read, save and OAuth callback. Complete customer-owned provider setup/save/reload/OAuth and directory vendor-event flow through normal controls and real consumers.

## CF007

Status: `implemented-unverified`.

Complete Microsoft test-authority discovery and real application sign-in/callback execution with production issuer, signature, state, nonce and audience checks preserved.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF007).

Implementation: `packages/auth/src/lib/sso/microsoftSsoEmulator.ts`, `packages/auth/src/lib/nextAuthOptions.ts`, `packages/emulators/msgraph/src/wire.ts`, `packages/emulators/msgraph/src/core.ts`, `packages/emulators/msgraph/src/entraOidc.ts`.

Regression locations: `packages/auth/src/lib/sso/microsoftSsoEmulator.test.ts`, `packages/emulators/msgraph/tests/entraOidc.test.ts`.

Still required: Complete Microsoft test-authority discovery and real application sign-in/callback execution with production issuer, signature, state, nonce and audience checks preserved. Complete the Alga customer tenant-resolution/account-linking journey on the deployed runtime as well as signed Entra discovery/JWKS/PKCE and Auth.js protocol/session checks; protocol tests alone do not establish it.

## CF008

Status: `implemented-unverified`.

Complete customer-owned inbound email and requester reply through configured providers and running workers, including duplicate, pause and revoked-credential behavior.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF008).

Implementation: `packages/co-managed/src/inboundRequesterReply.ts`, `shared/services/email/inboundEmailCoreProcessor.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Complete customer-owned inbound email and requester reply through configured providers and running workers, including duplicate, pause and revoked-credential behavior. Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.

## CF009

Status: `implemented-unverified`.

Complete supported customer directory provisioning/sync and revocation through normal controls with signed identity and seat-limit enforcement.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF009).

Implementation: `server/src/components/co-managed/CoManagedProviderSetup.tsx`, `server/src/lib/productSurfaceRegistry.ts`.

Regression locations: `server/src/test/unit/product/providerSetupReachability.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Complete supported customer directory provisioning/sync and revocation through normal controls with signed identity and seat-limit enforcement. Complete customer-owned provider setup/save/reload/OAuth and directory vendor-event flow through normal controls and real consumers.

## CF010

Status: `implemented-unverified`.

Preserve completed initial invitation retain/send/acknowledge behavior through fresh setup, retry, token races and customer acceptance.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF010).

Implementation: `packages/co-managed/src/provisioning.ts`, `packages/co-managed/src/acceptance.ts`, `server/src/components/co-managed/CoManagedClientSetup.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedAcceptanceActions.test.ts`.

Still required: Preserve completed initial invitation retain/send/acknowledge behavior through fresh setup, retry, token races and customer acceptance. Complete fresh-client invitation/setup/acceptance through the application and actual delivery/worker composition; database fixtures cover only part of the journey.

## CF011

Status: `implemented-unverified`.

Close ticket-list coordinator, native state/history/detail-return and qualified initial-entry requirements F003/F006/F012 with native fallback.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF011).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Close ticket-list coordinator, native state/history/detail-return and qualified initial-entry requirements F003/F006/F012 with native fallback. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## CF012

Status: `implemented-unverified`.

Close list composition, native metadata/defaults and qualified view/filter/search/sort/pagination requirements F010/F015/F017/F020/F021/F022.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF012).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Close list composition, native metadata/defaults and qualified view/filter/search/sort/pagination requirements F010/F015/F017/F020/F021/F022. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## CF013

Status: `implemented-unverified`.

Close full filtered CSV and routed MSP-owned creation requirements F024/F025/F026 without scope or identity confusion.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF013).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Close full filtered CSV and routed MSP-owned creation requirements F024/F025/F026 without scope or identity confusion. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## CF014

Status: `implemented-unverified`.

Close qualified selection and handback F027-F031 with immutable uncertain-retry identity, actor-scoped reload recovery and per-item reconciliation.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF014).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Close qualified selection and handback F027-F031 with immutable uncertain-retry identity, actor-scoped reload recovery and per-item reconciliation. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## CF015

Status: `implemented-unverified`.

Close stale-result/error/flag/presentation/entry consolidation F032/F036/F038/F039 and client integration presentation evidence.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF015).

Implementation: `server/src/components/co-managed/QualifiedTicketList.tsx`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedTicketSection.tsx`.

Regression locations: `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`.

Still required: Close stale-result/error/flag/presentation/entry consolidation F032/F036/F038/F039 and client integration presentation evidence. Complete translated light/dark/narrow/keyboard/focus browser acceptance and retain the required revision-specific evidence.

## CF016

Status: `implemented-unverified`.

Resolve the team picker interaction failure and demonstrate customer/shared work assignment through the actual UI.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF016).

Implementation: `server/src/components/co-managed/CoManagedAssignmentField.tsx`, `server/src/components/co-managed/CoManagedProjectTaskAssignment.tsx`.

Regression locations: `server/src/test/unit/product/coManagedTicketAssignmentActions.test.ts`, `server/src/test/unit/product/coManagedProjectTaskEditor.test.tsx`.

Still required: Resolve the team picker interaction failure and demonstrate customer/shared work assignment through the actual UI. Demonstrate the real hydrated team/person picker with pointer and keyboard; action/SQL assignment is not that proof.

## CF017

Status: `implemented-unverified`.

Render shared MSP effort in ordinary timesheet grid/detail/export consistently with totals while retaining empty-sheet dispatch and qualified edit authority.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF017).

Implementation: `packages/co-managed/src/nativeTimeDispatch.ts`, `packages/co-managed/src/nativeTimeSheetList.ts`, `packages/co-managed/src/timeBillingProfile.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedTimeEntry.test.tsx`.

Still required: Render shared MSP effort in ordinary timesheet grid/detail/export consistently with totals while retaining empty-sheet dispatch and qualified edit authority. Complete native grid/detail/export/approval/invoice application journeys and confirm totals/privacy; service tests do not establish screen usability.

## CF018

Status: `implemented-unverified`.

Complete native/customer/shared time approval and billing journeys; repair the reported absent-column API path if reachable by required flows or prove its exclusion.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF018).

Implementation: `packages/co-managed/src/nativeTimeDispatch.ts`, `packages/co-managed/src/nativeTimeSheetList.ts`, `packages/co-managed/src/timeBillingProfile.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedTimeEntry.test.tsx`.

Still required: Complete native/customer/shared time approval and billing journeys; repair the reported absent-column API path if reachable by required flows or prove its exclusion. Complete native grid/detail/export/approval/invoice application journeys and confirm totals/privacy; service tests do not establish screen usability.

## CF019

Status: `implemented-unverified`.

Prove assembled revocation across live UI/API/files/search and queued delivery without late unauthorized effects.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF019).

Implementation: `packages/co-managed/src/sharedWork.ts`, `packages/co-managed/src/customerWork.ts`, `packages/co-managed/src/sharedWorkRead.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedSharedWorkActions.test.ts`.

Still required: Prove assembled revocation across live UI/API/files/search and queued delivery without late unauthorized effects. Complete the full two-session API/search/download/realtime/queued-delivery matrix; a ticket collision regression covers only part of it.

## CF020

Status: `implemented-unverified`.

Prove the original 30-day lapse deadline, immediate growth denial and durable once-only recovery with both deployed worker compositions.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF020).

Implementation: `packages/licensing/src/lib/co-managed-lifecycle.ts`, `packages/co-managed/src/inboundRequesterReply.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Prove the original 30-day lapse deadline, immediate growth denial and durable once-only recovery with both deployed worker compositions. Complete original-deadline lapse and once-only renewal through both deployed worker compositions.

## CF021

Status: `implemented-unverified`.

Complete independent customer/MSP SLA transitions, author/audience qualification and both running SLA backends.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF021).

Implementation: `packages/co-managed/src/ticketSla.ts`, `server/src/components/co-managed/CoManagedSlaPolicyPanel.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedOrganizationSlaClock.test.ts`.

Still required: Complete independent customer/MSP SLA transitions, author/audience qualification and both running SLA backends. Exercise escalation/reply/handback/close/reopen with both running SLA backends and duplicate consumer delivery.

## CF022

Status: `implemented-unverified`.

Complete hosted pool purchase and independent upgrade through real application/simulator flows with verified entitlement and one allocation release.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF022).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Complete hosted pool purchase and independent upgrade through real application/simulator flows with verified entitlement and one allocation release. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## CF023

Status: `implemented-unverified`.

Complete self-host pool admission, renewal and independent upgrade through signed test-license controls without inheriting the sponsor license.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF023).

Implementation: `packages/licensing/src/lib/co-managed-license.ts`, `packages/licensing/src/lib/co-managed-entitlements.ts`.

Regression locations: `packages/licensing/src/lib/co-managed-license.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Complete self-host pool admission, renewal and independent upgrade through signed test-license controls without inheriting the sponsor license. Exercise normal signed-license import/refresh and independent upgrade controls; raw entitlement fixtures alone do not satisfy the signed-license journey.

## CF024

Status: `implemented-unverified`.

Complete source-unavailable customer export/restore through native screens including files, encrypted business credentials, attribution and excluded live trust.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF024).

Implementation: `packages/co-managed/src/portableExport.ts`, `packages/co-managed/src/portableTransfer.ts`, `server/src/components/co-managed/CoManagedPortableExport.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedPortableExport.test.tsx`.

Still required: Complete source-unavailable customer export/restore through native screens including files, encrypted business credentials, attribution and excluded live trust. Complete source-unavailable export/restore through native screens; compare permitted records/files/credentials and prove tamper/interruption recovery.

## CF025

Status: `implemented-unverified`.

Verify actual customer deletion after departure preserves authorized MSP invoice/archive content and denies revived live access.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF025).

Implementation: `packages/co-managed/src/archiveReads.ts`, `packages/co-managed/src/departure.ts`, `packages/co-managed/src/relationshipClosure.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedArchive.test.tsx`.

Still required: Verify actual customer deletion after departure preserves authorized MSP invoice/archive content and denies revived live access. Exercise actual customer deletion and retained MSP invoice/archive access; PostgreSQL/Citus runtime invariants need their own acceptance.

## CF026

Status: `implemented-unverified`.

Verify fresh/populated-upgrade PostgreSQL/Citus migrations and each distributed invariant whose trigger is omitted; repair any unguarded production write.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF026).

Implementation: `server/migrations/20260906010000_create_co_management_foundation.cjs`, `server/migrations/utils/citusDistribution.cjs`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Verify fresh/populated-upgrade PostgreSQL/Citus migrations and each distributed invariant whose trigger is omitted; repair any unguarded production write. Execute fresh/populated-upgrade/rollback and distributed Citus mutation invariants; a PostgreSQL schema clone is not a Citus installation or upgrade.

## CF027

Status: `implemented-unverified`.

Diagnose app healing and align app/worker/dist/schema provenance; complete the sustained authenticated review and worker-consumption stability check.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF027).

Implementation: `docs/dev/co-managed-review-services.md`, `scripts/dev/run-co-managed-dev-server.sh`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Diagnose app healing and align app/worker/dist/schema provenance; complete the sustained authenticated review and worker-consumption stability check. Requires current app/worker build provenance, authenticated walkthrough and 30 minutes without healing; unit/service tests do not establish runtime stability.

## CF028

Status: `implemented-unverified`.

Produce reproducible fixture reset/apply logs and faithful screenshot/DB/browser evidence without deleting unrelated records or secrets.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF028).

Implementation: `scripts/dev/co-managed-fixtures.ts`, `docs/dev/co-managed-fixtures.md`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Produce reproducible fixture reset/apply logs and faithful screenshot/DB/browser evidence without deleting unrelated records or secrets. Requires fixture reset/apply/reapply and current application/DB evidence. Disposable test fixtures are not the review-stack reset/stability proof.

## CF029

Status: `implemented-unverified`.

Obtain affected build/type/native regression and mandatory exact-candidate CI success while preserving lane collection, failures and runtime schema selection.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF029).

Implementation: `server/package.json`, `ee/temporal-workflows/package.json`.

Regression locations: `server/src/test/unit/product/coManagedFeatureBoundary.test.tsx`.

Still required: Obtain affected build/type/native regression and mandatory exact-candidate CI success while preserving lane collection, failures and runtime schema selection. Requires affected local typechecks/regressions, CE/EE builds and exact-candidate CI/mergeability acceptance; local test counts do not establish CI success.

## CF030

Status: `implemented-unverified`.

Implement the complete-ID readiness manifest and fail-closed read-only verifier with separate implementation, human-review and production verdicts.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF030).

Implementation: `scripts/lib/co-managed-plan-ids.mjs`, `scripts/lib/co-managed-completion.mjs`, `scripts/build-co-managed-inventory.mjs`.

Regression locations: `scripts/tests/co-managed-plan-ids.test.mjs`, `scripts/tests/co-managed-completion.test.mjs`.

Still required: Implement the complete-ID readiness manifest and fail-closed read-only verifier with separate implementation, human-review and production verdicts. Gate behavior is tested; actual-candidate acceptance cannot pass until every required evidence obligation is met. Do not relax the gate or convert a source census into acceptance.

## CF031

Status: `implemented-unverified`.

Reconcile the final PR/guide/plan/evidence packet and supply the verifier verdict to the XO, preserving false readiness until all in-card gates pass.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF031).

Implementation: `docs/evidence/co-managed-completion/README.md`, `scripts/verify-co-managed-completion.mjs`.

Regression locations: `scripts/tests/co-managed-completion.test.mjs`.

Still required: Reconcile the final PR/guide/plan/evidence packet and supply the verifier verdict to the XO, preserving false readiness until all in-card gates pass. Requires final PR/guide/recording/runtime/CI packet reconciliation and the actual-candidate verifier verdict before human-review readiness.

## CF032

Status: `implemented-unverified`.

Record owned external real-provider/deployment prerequisites separately from card-scoped simulator acceptance, with production readiness false until release-owner acceptance.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/features.json` (CF032).

Implementation: `docs/evidence/co-managed-completion/README.md`, `scripts/verify-co-managed-completion.mjs`.

Regression locations: `scripts/tests/co-managed-completion.test.mjs`.

Still required: Record owned external real-provider/deployment prerequisites separately from card-scoped simulator acceptance, with production readiness false until release-owner acceptance. Requires final PR/guide/recording/runtime/CI packet reconciliation and the actual-candidate verifier verdict before human-review readiness.

## CT001

Status: `implemented-unverified`.

Inventory all foundation T01-T22 and every feature/test ID in both follow-on plans; fail on absent/duplicate/unmapped IDs, silently removed scope or true flags without acceptance records. Preserve T018/T019 real-provider requirements as external evidence, not simulator passes.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT001).

Implementation: `scripts/lib/co-managed-plan-ids.mjs`, `scripts/lib/co-managed-completion.mjs`, `scripts/build-co-managed-inventory.mjs`.

Regression locations: `scripts/tests/co-managed-plan-ids.test.mjs`, `scripts/tests/co-managed-completion.test.mjs`.

Still required: Inventory all foundation T01-T22 and every feature/test ID in both follow-on plans; fail on absent/duplicate/unmapped IDs, silently removed scope or true flags without acceptance records. Preserve T018/T019 real-provider requirements as external evidence, not simulator passes. Gate behavior is tested; actual-candidate acceptance cannot pass until every required evidence obligation is met. Do not relax the gate or convert a source census into acceptance.

## CT002

Status: `implemented-unverified`.

Reproduce or capture in instrumented CI the original-seed requester failure; preserve safe first-error diagnostics and identify the causal difference. Original full shard must pass after the fix and a targeted regression or mutation must detect its removal.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT002).

Implementation: `packages/co-managed/src/inboundRequesterReply.ts`, `shared/services/email/inboundEmailCoreProcessor.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Reproduce or capture in instrumented CI the original-seed requester failure; preserve safe first-error diagnostics and identify the causal difference. Original full shard must pass after the fix and a targeted regression or mutation must detect its removal. Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.

## CT003

Status: `implemented-unverified`.

Migrated DB: pause after tentative requester admission writes; expect defer/co_managed_read_only, unchanged comments, zero effects/outbox, received inbox, refunded attempt and retained source. Cover separate compiled constructors and both worker compositions; unknown error remains retry and unauthorized/malformed requester remains quarantined without native fallback.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT003).

Implementation: `packages/co-managed/src/inboundRequesterReply.ts`, `shared/services/email/inboundEmailCoreProcessor.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Migrated DB: pause after tentative requester admission writes; expect defer/co_managed_read_only, unchanged comments, zero effects/outbox, received inbox, refunded attempt and retained source. Cover separate compiled constructors and both worker compositions; unknown error remains retry and unauthorized/malformed requester remains quarantined without native fallback. Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.

## CT004

Status: `implemented-unverified`.

Run deferred requester delivery through the real worker, renew entitlement and replay the same inbox twice; assert one reply/effect and no lost source or inflated attempts. Include native/non-requester regression.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT004).

Implementation: `packages/co-managed/src/inboundRequesterReply.ts`, `shared/services/email/inboundEmailCoreProcessor.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Run deferred requester delivery through the real worker, renew entitlement and replay the same inbox twice; assert one reply/effect and no lost source or inflated attempts. Include native/non-requester regression. Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.

## CT005

Status: `implemented-unverified`.

Run requester tests in standalone, original CI shard seed 20260610 and one additional shuffled order with the CE+EE overlay, clean built artifacts and CI runtime DB selection. Prove finite first-error reporting and no weakened lane/collection/expectation or clone-source pin.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT005).

Implementation: `packages/co-managed/src/inboundRequesterReply.ts`, `shared/services/email/inboundEmailCoreProcessor.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Run requester tests in standalone, original CI shard seed 20260610 and one additional shuffled order with the CE+EE overlay, clean built artifacts and CI runtime DB selection. Prove finite first-error reporting and no weakened lane/collection/expectation or clone-source pin. Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.

## CT006

Status: `implemented-unverified`.

Browser plus migrated actions: customer Email/Open Providers and identity/directory links open allowed configuration and return correctly; save/reload tenant-owned settings. Deny unrelated integration categories, direct URLs/actions, foreign tenant callbacks, secret reads and ungranted delegated roles. Preserve native PSA/AlgaDesk configuration.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT006).

Implementation: `server/src/components/co-managed/CoManagedProviderSetup.tsx`, `server/src/lib/productSurfaceRegistry.ts`.

Regression locations: `server/src/test/unit/product/providerSetupReachability.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Browser plus migrated actions: customer Email/Open Providers and identity/directory links open allowed configuration and return correctly; save/reload tenant-owned settings. Deny unrelated integration categories, direct URLs/actions, foreign tenant callbacks, secret reads and ungranted delegated roles. Preserve native PSA/AlgaDesk configuration. Complete customer-owned provider setup/save/reload/OAuth and directory vendor-event flow through normal controls and real consumers.

## CT007

Status: `implemented-unverified`.

Fresh client through real provisioning/invitation/setup/acceptance: capture send completion outside the retaining transaction, one retained activation/allocation, retry recovery and stale-token acknowledgment denial. Cover last-seat invitation/acceptance concurrency and failed/cancelled setup using disposable fixtures.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT007).

Implementation: `packages/co-managed/src/provisioning.ts`, `packages/co-managed/src/acceptance.ts`, `server/src/components/co-managed/CoManagedClientSetup.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedAcceptanceActions.test.ts`.

Still required: Fresh client through real provisioning/invitation/setup/acceptance: capture send completion outside the retaining transaction, one retained activation/allocation, retry recovery and stale-token acknowledgment denial. Cover last-seat invitation/acceptance concurrency and failed/cancelled setup using disposable fixtures. Complete fresh-client invitation/setup/acceptance through the application and actual delivery/worker composition; database fixtures cover only part of the journey.

## CT008

Status: `implemented-unverified`.

Real application Microsoft sign-in against approved OIDC simulation: discovery, authorization callback, signature/state/nonce/audience/tenant validation and session binding. Reject forged/wrong-tenant/wrong-issuer callbacks; verify server-only test configuration and production/default native authentication behavior.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT008).

Implementation: `packages/auth/src/lib/sso/microsoftSsoEmulator.ts`, `packages/auth/src/lib/nextAuthOptions.ts`, `packages/emulators/msgraph/src/wire.ts`, `packages/emulators/msgraph/src/core.ts`, `packages/emulators/msgraph/src/entraOidc.ts`.

Regression locations: `packages/auth/src/lib/sso/microsoftSsoEmulator.test.ts`, `packages/emulators/msgraph/tests/entraOidc.test.ts`.

Still required: Real application Microsoft sign-in against approved OIDC simulation: discovery, authorization callback, signature/state/nonce/audience/tenant validation and session binding. Reject forged/wrong-tenant/wrong-issuer callbacks; verify server-only test configuration and production/default native authentication behavior. Complete the Alga customer tenant-resolution/account-linking journey on the deployed runtime as well as signed Entra discovery/JWKS/PKCE and Auth.js protocol/session checks; protocol tests alone do not establish it.

## CT009

Status: `implemented-unverified`.

Configure customer inbound mail and directory through normal UI, then deliver vendor events to running workers. Assert customer-owned ticket/reply and directory membership with seat enforcement; duplicates, expired/revoked credentials, cross-tenant sender/provider, paused intake and renewal cannot leak or duplicate. Distinguish calendar sync and SMTP from these flows.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT009).

Implementation: `server/src/components/co-managed/CoManagedProviderSetup.tsx`, `server/src/lib/productSurfaceRegistry.ts`.

Regression locations: `server/src/test/unit/product/providerSetupReachability.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Configure customer inbound mail and directory through normal UI, then deliver vendor events to running workers. Assert customer-owned ticket/reply and directory membership with seat enforcement; duplicates, expired/revoked credentials, cross-tenant sender/provider, paused intake and renewal cannot leak or duplicate. Distinguish calendar sync and SMTP from these flows. Complete customer-owned provider setup/save/reload/OAuth and directory vendor-event flow through normal controls and real consumers.

## CT010

Status: `implemented-unverified`.

Exercise native→working→oversight→native and browser Back/Forward/detail return/create navigation with native boards/defaults/bundles/filters/columns/selection preserved. Cover global, client page/drawer, legacy and qualified initial URLs. Map follow-on T002/T005/T008/T009/T016/T018.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT010).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Exercise native→working→oversight→native and browser Back/Forward/detail return/create navigation with native boards/defaults/bundles/filters/columns/selection preserved. Cover global, client page/drawer, legacy and qualified initial URLs. Map follow-on T002/T005/T008/T009/T016/T018. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## CT011

Status: `implemented-unverified`.

Migrated DB and actual list: multiple workspaces with duplicate record numbers/IDs; authorized working/oversight membership, client/workspace/search/state/sort/page/count and full CSV. Revoke scope during delayed reads/export; deny hidden rows/counts/options and retain correct owner routes. Map follow-on T003/T004/T007/T009/T010/T015.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT011).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Migrated DB and actual list: multiple workspaces with duplicate record numbers/IDs; authorized working/oversight membership, client/workspace/search/state/sort/page/count and full CSV. Revoke scope during delayed reads/export; deny hidden rows/counts/options and retain correct owner routes. Map follow-on T003/T004/T007/T009/T010/T015. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## CT012

Status: `implemented-unverified`.

Create an MSP-owned ticket from a customer-narrowed view with explicit out-of-scope success link. Submit partial qualified handback, interrupt after a committed item, reload and retry exact intent; assert immutable IDs/notes/revisions, one receipt per success, stale/denied outcomes, actor/expiry cleanup and no automatic resubmit. Map follow-on T011-T014.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT012).

Implementation: `packages/co-managed/src/ticketQueue.ts`, `server/src/components/co-managed/QualifiedTicketList.tsx`, `packages/tickets/src/lib/ticketListScope.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedTicketQueueActions.test.ts`.

Still required: Create an MSP-owned ticket from a customer-narrowed view with explicit out-of-scope success link. Submit partial qualified handback, interrupt after a committed item, reload and retry exact intent; assert immutable IDs/notes/revisions, one receipt per success, stale/denied outcomes, actor/expiry cleanup and no automatic resubmit. Map follow-on T011-T014. Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.

## CT013

Status: `implemented-unverified`.

Real translated/light/dark/narrow client and list presentation with long qualified titles, keyboard/focus, supported columns and native fitting retained. Toggle disabled/loading/unknown/error UI flag while dialog/read/export/handback is pending; no stale shared UI/read and native fallback works. Map follow-on T006/T017/T019 and client T021.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT013).

Implementation: `server/src/components/co-managed/QualifiedTicketList.tsx`, `server/src/components/co-managed/CoManagedClientIntegration.tsx`, `server/src/components/co-managed/CoManagedTicketSection.tsx`.

Regression locations: `server/src/test/unit/product/qualifiedTicketList.test.tsx`, `server/src/test/unit/product/coManagedClientIntegration.test.tsx`.

Still required: Real translated/light/dark/narrow client and list presentation with long qualified titles, keyboard/focus, supported columns and native fitting retained. Toggle disabled/loading/unknown/error UI flag while dialog/read/export/handback is pending; no stale shared UI/read and native fallback works. Map follow-on T006/T017/T019 and client T021. Complete translated light/dark/narrow/keyboard/focus browser acceptance and retain the required revision-specific evidence.

## CT014

Status: `implemented-unverified`.

Real task assignment through the team picker and new empty-sheet Log time/save/reload; native grid/detail/export entries match totals. Exercise customer service-free effort, MSP commercial effort, edit/delete/move/approval/on-behalf denial and invoice generation/replay. Trace any absent-column workflow API use and prove privacy/operational nonbilling.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT014).

Implementation: `packages/co-managed/src/nativeTimeDispatch.ts`, `packages/co-managed/src/nativeTimeSheetList.ts`, `packages/co-managed/src/timeBillingProfile.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedTimeEntry.test.tsx`.

Still required: Real task assignment through the team picker and new empty-sheet Log time/save/reload; native grid/detail/export entries match totals. Exercise customer service-free effort, MSP commercial effort, edit/delete/move/approval/on-behalf denial and invoice generation/replay. Trace any absent-column workflow API use and prove privacy/operational nonbilling. Complete native grid/detail/export/approval/invoice application journeys and confirm totals/privacy; service tests do not establish screen usability.

## CT015

Status: `implemented-unverified`.

Two-session revocation with open ticket/project/portal, cached search, file download, API write and queued notifications/mail: after authority is revoked, no new protected data/effect is admitted. Shared/private/requester audience, unshared project and delegated-scope guards remain intact.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT015).

Implementation: `packages/co-managed/src/sharedWork.ts`, `packages/co-managed/src/customerWork.ts`, `packages/co-managed/src/sharedWorkRead.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedSharedWorkActions.test.ts`.

Still required: Two-session revocation with open ticket/project/portal, cached search, file download, API write and queued notifications/mail: after authority is revoked, no new protected data/effect is admitted. Shared/private/requester audience, unshared project and delegated-scope guards remain intact. Complete the full two-session API/search/download/realtime/queued-delivery matrix; a ticket collision regression covers only part of it.

## CT016

Status: `implemented-unverified`.

Hosted and signed-test-license self-host lapse with real workers: growth denied immediately, writes stop at original 30-day deadline, reads/export/recovery remain allowed, reduced capacity deletes no users, renewal resumes same retained inbox/artifact once.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT016).

Implementation: `packages/licensing/src/lib/co-managed-lifecycle.ts`, `packages/co-managed/src/inboundRequesterReply.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/email/coManagedAdmissionAdapters.test.ts`.

Still required: Hosted and signed-test-license self-host lapse with real workers: growth denied immediately, writes stop at original 30-day deadline, reads/export/recovery remain allowed, reduced capacity deletes no users, renewal resumes same retained inbox/artifact once. Complete original-deadline lapse and once-only renewal through both deployed worker compositions.

## CT017

Status: `implemented-unverified`.

Real escalation/handback/re-escalation/reply/close/reopen across different priorities/calendars in both SLA backends: customer clock independent, MSP starts only at escalation, qualifying authors/audiences honored, duplicate jobs add no transitions or breaches.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT017).

Implementation: `packages/co-managed/src/ticketSla.ts`, `server/src/components/co-managed/CoManagedSlaPolicyPanel.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedOrganizationSlaClock.test.ts`.

Still required: Real escalation/handback/re-escalation/reply/close/reopen across different priorities/calendars in both SLA backends: customer clock independent, MSP starts only at escalation, qualifying authors/audiences honored, duplicate jobs add no transitions or breaches. Exercise escalation/reply/handback/close/reopen with both running SLA backends and duplicate consumer delivery.

## CT018

Status: `implemented-unverified`.

Hosted application/simulator journey: shortfall preview, checkout, verified webhook/reconciliation, allocation and independent upgrade. Verify purchased quantity, ordinary seats unchanged, duplicate/out-of-order events, interrupted payment/seed recovery and exactly one activation/allocation release. Explicitly label any vendor control completion and exclude real payment-UI/price claims.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT018).

Implementation: `packages/licensing/src/lib/co-managed-purchases.ts`, `server/src/components/co-managed/useCoManagedPurchaseController.ts`.

Regression locations: `server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts`, `server/src/test/unit/product/coManagedPoolEditor.test.tsx`.

Still required: Hosted application/simulator journey: shortfall preview, checkout, verified webhook/reconciliation, allocation and independent upgrade. Verify purchased quantity, ordinary seats unchanged, duplicate/out-of-order events, interrupted payment/seed recovery and exactly one activation/allocation release. Explicitly label any vendor control completion and exclude real payment-UI/price claims. Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.

## CT019

Status: `implemented-unverified`.

Self-host normal license controls: signed test sponsor capacity, shortfall recovery, expiry/wrong-audience/missing-claim denial, renewal and independent customer upgrade. Verify offline validity, independent seats and exactly one release without sponsor-license fallback; raw entitlement fixtures alone do not pass.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT019).

Implementation: `packages/licensing/src/lib/co-managed-license.ts`, `packages/licensing/src/lib/co-managed-entitlements.ts`.

Regression locations: `packages/licensing/src/lib/co-managed-license.test.ts`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Self-host normal license controls: signed test sponsor capacity, shortfall recovery, expiry/wrong-audience/missing-claim denial, renewal and independent customer upgrade. Verify offline validity, independent seats and exactly one release without sponsor-license fallback; raw entitlement fixtures alone do not pass. Exercise normal signed-license import/refresh and independent upgrade controls; raw entitlement fixtures alone do not satisfy the signed-license journey.

## CT020

Status: `implemented-unverified`.

Export customer workspace and restore through native UI into an isolated target with source unavailable. Compare permitted records/files/configuration/attribution/credential manifests; reject tampering/wrong key, recover interruption, exclude MSP-private data/live sessions/OAuth secrets/old grants and verify usable restored work.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT020).

Implementation: `packages/co-managed/src/portableExport.ts`, `packages/co-managed/src/portableTransfer.ts`, `server/src/components/co-managed/CoManagedPortableExport.tsx`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedPortableExport.test.tsx`.

Still required: Export customer workspace and restore through native UI into an isolated target with source unavailable. Compare permitted records/files/configuration/attribution/credential manifests; reject tampering/wrong key, recover interruption, exclude MSP-private data/live sessions/OAuth secrets/old grants and verify usable restored work. Complete source-unavailable export/restore through native screens; compare permitted records/files/credentials and prove tamper/interruption recovery.

## CT021

Status: `implemented-unverified`.

After departure and hosted/self-host upgrade, execute actual customer deletion on disposable data; render MSP invoice and download retained participation archive/files. Verify bounded history, preserved MSP time/commercial records, independent customer data and denied old trust.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT021).

Implementation: `packages/co-managed/src/archiveReads.ts`, `packages/co-managed/src/departure.ts`, `packages/co-managed/src/relationshipClosure.ts`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`, `server/src/test/unit/product/coManagedArchive.test.tsx`.

Still required: After departure and hosted/self-host upgrade, execute actual customer deletion on disposable data; render MSP invoice and download retained participation archive/files. Verify bounded history, preserved MSP time/commercial records, independent customer data and denied old trust. Exercise actual customer deletion and retained MSP invoice/archive access; PostgreSQL/Citus runtime invariants need their own acceptance.

## CT022

Status: `implemented-unverified`.

Candidate fresh install/populated upgrade and supported rollback/reapply on PostgreSQL/Citus. Inventory all 17 trigger-skipping migrations and execute happy/guard/concurrent mutation tests on distributed production write paths, including immutable history and operational time preservation. DDL-only or PG trigger proofs do not pass Citus invariants.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT022).

Implementation: `server/migrations/20260906010000_create_co_management_foundation.cjs`, `server/migrations/utils/citusDistribution.cjs`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Candidate fresh install/populated upgrade and supported rollback/reapply on PostgreSQL/Citus. Inventory all 17 trigger-skipping migrations and execute happy/guard/concurrent mutation tests on distributed production write paths, including immutable history and operational time preservation. DDL-only or PG trigger proofs do not pass Citus invariants. Execute fresh/populated-upgrade/rollback and distributed Citus mutation invariants; a PostgreSQL schema clone is not a Citus installation or upgrade.

## CT023

Status: `implemented-unverified`.

Candidate app/worker/dist/schema provenance and authenticated complete walkthrough followed by 30-minute observation plus queued-job consumption; no restart/healing. Capture first cause of any interruption and repeat only after correction.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT023).

Implementation: `docs/dev/co-managed-review-services.md`, `scripts/dev/run-co-managed-dev-server.sh`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Candidate app/worker/dist/schema provenance and authenticated complete walkthrough followed by 30-minute observation plus queued-job consumption; no restart/healing. Capture first cause of any interruption and repeat only after correction. Requires current app/worker build provenance, authenticated walkthrough and 30 minutes without healing; unit/service tests do not establish runtime stability.

## CT024

Status: `implemented-unverified`.

Capture fixture version, apply/reset/verify/reapply commands, exit codes, raw stdout and DB counts, including real composite-FK/audit rows; match screenshots to claims and distinguish SQL-seeded from UI-created evidence. Preserve unrelated accounting/claimed workspace records and refresh time periods.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT024).

Implementation: `scripts/dev/co-managed-fixtures.ts`, `docs/dev/co-managed-fixtures.md`.

Regression locations: `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Capture fixture version, apply/reset/verify/reapply commands, exit codes, raw stdout and DB counts, including real composite-FK/audit rows; match screenshots to claims and distinguish SQL-seeded from UI-created evidence. Preserve unrelated accounting/claimed workspace records and refresh time periods. Requires fixture reset/apply/reapply and current application/DB evidence. Disposable test fixtures are not the review-stack reset/stability proof.

## CT025

Status: `implemented-unverified`.

Run affected CE/EE builds/types and native PSA/AlgaDesk regressions, mandatory exact-candidate CI aggregates and real flag-off authorized/denied APIs/actions/workers. Confirm required jobs collected/executed, mergeability/base current, candidate equals app/worker/PR and no lane bypass.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT025).

Implementation: `server/package.json`, `ee/temporal-workflows/package.json`.

Regression locations: `server/src/test/unit/product/coManagedFeatureBoundary.test.tsx`.

Still required: Run affected CE/EE builds/types and native PSA/AlgaDesk regressions, mandatory exact-candidate CI aggregates and real flag-off authorized/denied APIs/actions/workers. Confirm required jobs collected/executed, mergeability/base current, candidate equals app/worker/PR and no lane bypass. Requires affected local typechecks/regressions, CE/EE builds and exact-candidate CI/mergeability acceptance; local test counts do not establish CI success.

## CT026

Status: `implemented-unverified`.

Readiness verifier negative cases: missing/duplicate/unmapped requirement, open false flag, stale SHA, missing artifact, skipped/cancelled/pending/failed CI, conflicting/unknown mergeability, unhealthy or wrong-revision worker and prose-only completion all fail. One complete fixture passes review readiness while unresolved external provider dependencies keep production false. Final actual-candidate invocation and packet reconciliation must pass before XO review eligibility.

Specification: `docs/plans/2026-09-20-co-managed-it-completion/tests.json` (CT026).

Implementation: `scripts/lib/co-managed-plan-ids.mjs`, `scripts/lib/co-managed-completion.mjs`, `scripts/build-co-managed-inventory.mjs`.

Regression locations: `scripts/tests/co-managed-plan-ids.test.mjs`, `scripts/tests/co-managed-completion.test.mjs`.

Still required: Readiness verifier negative cases: missing/duplicate/unmapped requirement, open false flag, stale SHA, missing artifact, skipped/cancelled/pending/failed CI, conflicting/unknown mergeability, unhealthy or wrong-revision worker and prose-only completion all fail. One complete fixture passes review readiness while unresolved external provider dependencies keep production false. Final actual-candidate invocation and packet reconciliation must pass before XO review eligibility. Gate behavior is tested; actual-candidate acceptance cannot pass until every required evidence obligation is met. Do not relax the gate or convert a source census into acceptance.

## nativeTicketScreen:F001

Status: `implemented-unverified`.

Define TicketDataSource interface in packages/tickets covering every ticket-scoped read/write TicketDetails and its sections make

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F001).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Define TicketDataSource interface in packages/tickets covering every ticket-scoped read/write TicketDetails and its sections make Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F002

Status: `implemented-unverified`.

TicketDataSourceContext + useTicketDataSource hook with a native default built from the existing imported actions

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F002).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: TicketDataSourceContext + useTicketDataSource hook with a native default built from the existing imported actions Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F003

Status: `implemented-unverified`.

TicketCapabilities type delivered by the data source; native default enables every section (existing hide*/isAlgaDeskMode flags still apply)

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F003).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: TicketCapabilities type delivered by the data source; native default enables every section (existing hide*/isAlgaDeskMode flags still apply) Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F004

Status: `implemented-unverified`.

TicketDetailsContainer field/batch/comment/description writes go through the data source

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F004).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: TicketDetailsContainer field/batch/comment/description writes go through the data source Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F005

Status: `implemented-unverified`.

TicketDetails direct action calls (refresh, board, teams, resources, close checks, comments edit/delete/reply, contacts, recurring source) go through the data source

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F005).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: TicketDetails direct action calls (refresh, board, teams, resources, close checks, comments edit/delete/reply, contacts, recurring source) go through the data source Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F006

Status: `implemented-unverified`.

TicketInfo, TicketProperties, TicketConversation, CommentItem, CommentEmailRecipientsControl go through the data source

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F006).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: TicketInfo, TicketProperties, TicketConversation, CommentItem, CommentEmailRecipientsControl go through the data source Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F007

Status: `implemented-unverified`.

Bento layout (BentoHero, BentoTimelineTile, dataTiles, SlaClocksTile, TicketBentoLayout) goes through the data source

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F007).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Bento layout (BentoHero, BentoTimelineTile, dataTiles, SlaClocksTile, TicketBentoLayout) goes through the data source Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F008

Status: `implemented-unverified`.

Checklist, materials, external links, activity timeline, navigation, email notifications go through the data source or are gated by a capability

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F008).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Checklist, materials, external links, activity timeline, navigation, email notifications go through the data source or are gated by a capability Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F009

Status: `implemented-unverified`.

New capability flags: bundles, delete, tags, credentials, external links, checklist, documents, assets, materials, billing, email logs, activity log, reactions, live, survey, appointment requests, navigation

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F009).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: New capability flags: bundles, delete, tags, credentials, external links, checklist, documents, assets, materials, billing, email logs, activity log, reactions, live, survey, appointment requests, navigation Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F010

Status: `implemented-unverified`.

Avatar batch actions are routed through the data source and never receive a foreign tenant

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F010).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Avatar batch actions are routed through the data source and never receive a foreign tenant Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F011

Status: `implemented-unverified`.

window.location.reload / router.refresh / BackNav href / live provider become data-source driven (refresh callback, back href, live capability)

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F011).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: window.location.reload / router.refresh / BackNav href / live provider become data-source driven (refresh callback, back href, live capability) Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F012

Status: `implemented-unverified`.

Native ticket screen behavior unchanged: no extra requests, bootstrap/streams unchanged

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F012).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Native ticket screen behavior unchanged: no extra requests, bootstrap/streams unchanged Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F013

Status: `implemented-unverified`.

Extend the shared read with description (rich text), requester contact display name, client display name, category ref, due_date and customer assignee display, each redactable by home policy

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F013).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Extend the shared read with description (rich text), requester contact display name, client display name, category ref, due_date and customer assignee display, each redactable by home policy Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F014

Status: `implemented-unverified`.

Shared-ticket loader server function returns the TicketDetailsContainer ticketData shape from admitted redacted reads only; undisclosed fields absent

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F014).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Shared-ticket loader server function returns the TicketDetailsContainer ticketData shape from admitted redacted reads only; undisclosed fields absent Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F015

Status: `implemented-unverified`.

Category option search for the customer board via a co-managed option action (like status/priority)

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F015).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Category option search for the customer board via a co-managed option action (like status/priority) Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F016

Status: `implemented-unverified`.

Allow description and category_id in editCoManagedTicket (editableFields, baselines, receipts, close rules unchanged)

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F016).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Allow description and category_id in editCoManagedTicket (editableFields, baselines, receipts, close rules unchanged) Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F017

Status: `implemented-unverified`.

Shared data source maps native onTicketUpdate/onBatchTicketUpdate/onUpdateDescription to saveSharedTicketEditAction with per-field expected baselines and stable operation ids; conflict/unknownOutcome surfaced in the native save flow

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F017).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Shared data source maps native onTicketUpdate/onBatchTicketUpdate/onUpdateDescription to saveSharedTicketEditAction with per-field expected baselines and stable operation ids; conflict/unknownOutcome surfaced in the native save flow Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F018

Status: `implemented-unverified`.

Status/priority/category pickers on shared tickets list the customer's options via the co-managed option search

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F018).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Status/priority/category pickers on shared tickets list the customer's options via the co-managed option search Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F019

Status: `implemented-unverified`.

Native conversation reads shared conversation items (requester + shared_it from the customer store, organization_private from the sponsor store) with organization-qualified author labels

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F019).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Native conversation reads shared conversation items (requester + shared_it from the customer store, organization_private from the sponsor store) with organization-qualified author labels Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F020

Status: `implemented-unverified`.

Native composer shows an audience control (Requester / Shared IT teams / Private to <org>) instead of the Internal toggle when the data source reports audiences; default Shared IT on the MSP side

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F020).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Native composer shows an audience control (Requester / Shared IT teams / Private to <org>) instead of the Internal toggle when the data source reports audiences; default Shared IT on the MSP side Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F021

Status: `implemented-unverified`.

Create, reply, edit, delete and change-audience (disclosure) on shared tickets via the co-managed comment actions with operation ids and expectedUpdatedAt/revision guards

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F021).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Create, reply, edit, delete and change-audience (disclosure) on shared tickets via the co-managed comment actions with operation ids and expectedUpdatedAt/revision guards Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F022

Status: `implemented-unverified`.

Attachments on shared-ticket comments via the co-managed draft/attachment actions; image/file/mention blocks disabled in the editor for shared tickets

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F022).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Attachments on shared-ticket comments via the co-managed draft/attachment actions; image/file/mention blocks disabled in the editor for shared tickets Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F023

Status: `implemented-unverified`.

Customer side (local co-managed ticket): native conversation shows and writes audiences (requester/shared_it/private) on co_managed tickets

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F023).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Customer side (local co-managed ticket): native conversation shows and writes audiences (requester/shared_it/private) on co_managed tickets Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F024

Status: `implemented-unverified`.

Native-styled Co-managed section (Entry properties column and Grid tile): responsibility, customer + MSP SLA clocks, handoff actions

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F024).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Native-styled Co-managed section (Entry properties column and Grid tile): responsibility, customer + MSP SLA clocks, handoff actions Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F025

Status: `implemented-unverified`.

MSP assignment control (MSP users/teams) inside the Co-managed section, sponsor side; read-only display on the customer side

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F025).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: MSP assignment control (MSP users/teams) inside the Co-managed section, sponsor side; read-only display on the customer side Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F026

Status: `implemented-unverified`.

Escalate / hand back / take back / revoke dialogs using the native Dialog footer pattern with expectedRevision

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F026).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Escalate / hand back / take back / revoke dialogs using the native Dialog footer pattern with expectedRevision Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F027

Status: `implemented-unverified`.

Handoff history drawer in the Co-managed section with paging

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F027).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Handoff history drawer in the Co-managed section with paging Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F028

Status: `implemented-unverified`.

Work signals refresh (callout/badge) after assignment and handoff from the native screen

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F028).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Work signals refresh (callout/badge) after assignment and handoff from the native screen Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F029

Status: `implemented-unverified`.

Native stopwatch and time-entries list on shared tickets backed by the co-managed time work reference (work_item_type co_managed)

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F029).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Native stopwatch and time-entries list on shared tickets backed by the co-managed time work reference (work_item_type co_managed) Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F030

Status: `implemented-unverified`.

Effort split (customer / MSP / combined) shown in the time summary on both sides

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F030).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Effort split (customer / MSP / combined) shown in the time summary on both sides Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F031

Status: `implemented-unverified`.

Co-managed billing profile control available from the shared time entry flow

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F031).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Co-managed billing profile control available from the shared time entry flow Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F032

Status: `implemented-unverified`.

MSP route /msp/co-management/tickets/[customerTenant]/[relationshipId]/[ticketId] renders the native screen (server loader + shared data source provider) inside the MSP shell, customer workspace name in the header

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F032).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: MSP route /msp/co-management/tickets/[customerTenant]/[relationshipId]/[ticketId] renders the native screen (server loader + shared data source provider) inside the MSP shell, customer workspace name in the header Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F033

Status: `implemented-unverified`.

Customer side /msp/tickets/[id] renders the Co-managed section natively and no longer mounts CoManagedTicketPanel

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F033).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Customer side /msp/tickets/[id] renders the Co-managed section natively and no longer mounts CoManagedTicketPanel Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F034

Status: `implemented-unverified`.

Shared screen hides: bundles, materials, billing/quick invoice, delete, credentials, external links, email logs, survey, appointment requests, documents, checklist, assets, tags, live updates

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F034).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Shared screen hides: bundles, materials, billing/quick invoice, delete, credentials, external links, email logs, survey, appointment requests, documents, checklist, assets, tags, live updates Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F035

Status: `implemented-unverified`.

Read-only MSP viewer: every write affordance absent on the shared screen

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F035).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Read-only MSP viewer: every write affordance absent on the shared screen Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F036

Status: `implemented-unverified`.

Delete CoManagedTicketPanel, CoManagedTicketEditor, CoManagedTicketConversation, CoManagedTicketAssignment and other stacked panel children with no remaining caller; remove dead i18n keys

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F036).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Delete CoManagedTicketPanel, CoManagedTicketEditor, CoManagedTicketConversation, CoManagedTicketAssignment and other stacked panel children with no remaining caller; remove dead i18n keys Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:F037

Status: `implemented-unverified`.

i18n for new labels (audience control, co-managed section, effort split) in all locales

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/features.json` (F037).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: i18n for new labels (audience control, co-managed section, effort split) in all locales Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T001

Status: `implemented-unverified`.

TicketDetails renders with the native default data source and calls the same native actions as before (existing TicketDetails suites green, no new calls on mount)

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T001).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: TicketDetails renders with the native default data source and calls the same native actions as before (existing TicketDetails suites green, no new calls on mount) Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T002

Status: `implemented-unverified`.

Capabilities: a data source with shared capabilities renders no bundle, materials, billing, delete, credentials, external links, email logs, documents, checklist, assets, tags sections in either layout

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T002).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Capabilities: a data source with shared capabilities renders no bundle, materials, billing, delete, credentials, external links, email logs, documents, checklist, assets, tags sections in either layout Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T003

Status: `implemented-unverified`.

Negative: under the shared data source no native ticket-id action is invoked and avatar actions never receive the foreign tenant

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T003).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Negative: under the shared data source no native ticket-id action is invoked and avatar actions never receive the foreign tenant Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T004

Status: `implemented-unverified`.

DB integration: shared loader returns description/requester/client/category/due/customer assignee for an admitted sponsor and omits each when redacted by home policy; denied without staff assignment

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T004).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: DB integration: shared loader returns description/requester/client/category/due/customer assignee for an admitted sponsor and omits each when redacted by home policy; denied without staff assignment Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T005

Status: `implemented-unverified`.

DB integration: shared description/category edit applies via editCoManagedTicket with receipt; stale baseline returns conflict; same operation retry is idempotent

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T005).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: DB integration: shared description/category edit applies via editCoManagedTicket with receipt; stale baseline returns conflict; same operation retry is idempotent Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T006

Status: `implemented-unverified`.

Unit: changing status on the shared screen calls saveSharedTicketEditAction with expected baseline and lists customer options from the co-managed search

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T006).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Unit: changing status on the shared screen calls saveSharedTicketEditAction with expected baseline and lists customer options from the co-managed search Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T007

Status: `implemented-unverified`.

Unit: shared conversation shows org-qualified authors, hides customer-private notes, defaults to Shared IT and posts through createCoManagedTicketCommentAction; edit/delete/disclosure use the co-managed actions

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T007).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Unit: shared conversation shows org-qualified authors, hides customer-private notes, defaults to Shared IT and posts through createCoManagedTicketCommentAction; edit/delete/disclosure use the co-managed actions Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T008

Status: `implemented-unverified`.

Unit: shared composer disallows image/file/mention blocks; attachment upload goes through the co-managed draft flow

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T008).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Unit: shared composer disallows image/file/mention blocks; attachment upload goes through the co-managed draft flow Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T009

Status: `implemented-unverified`.

Unit: customer-side native composer on a co_managed ticket shows the audience control and writes the chosen audience

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T009).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Unit: customer-side native composer on a co_managed ticket shows the audience control and writes the chosen audience Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T010

Status: `implemented-unverified`.

Unit: Co-managed section shows responsibility, both SLAs, MSP assignment; hand back submits with expectedRevision, refreshes the screen and the work signals; history pages

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T010).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Unit: Co-managed section shows responsibility, both SLAs, MSP assignment; hand back submits with expectedRevision, refreshes the screen and the work signals; history pages Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T011

Status: `implemented-unverified`.

Unit: stopwatch/time entry on a shared ticket launches the native time entry with work_item_type co_managed; effort split refreshes after save

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T011).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Unit: stopwatch/time entry on a shared ticket launches the native time entry with work_item_type co_managed; effort split refreshes after save Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T012

Status: `implemented-unverified`.

Route tests: MSP shared route renders native TicketDetails with the shared provider (read-only viewer has no write affordances); customer route renders the Co-managed section and no panel

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T012).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Route tests: MSP shared route renders native TicketDetails with the shared provider (read-only viewer has no write affordances); customer route renders the Co-managed section and no panel Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T013

Status: `implemented-unverified`.

Contract: no remaining imports of the deleted panel components

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T013).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Contract: no remaining imports of the deleted panel components Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.

## nativeTicketScreen:T014

Status: `implemented-unverified`.

Browser evidence: MSP on the shared ticket in Entry and Grid layouts — status change, Shared IT message, private note, stopwatch/time entry, MSP assignment, hand back; customer side shows the Co-managed section

Specification: `docs/plans/2026-10-15-co-managed-native-ticket-screen/tests.json` (T014).

Implementation: `packages/tickets/src/lib/ticketDataSource.ts`, `server/src/components/co-managed/sharedTicketDataSource.tsx`, `server/src/components/co-managed/SharedTicketScreen.tsx`.

Regression locations: `server/src/test/unit/product/coManagedSharedTicketDataSource.test.tsx`, `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`.

Still required: Browser evidence: MSP on the shared ticket in Entry and Grid layouts — status change, Shared IT message, private note, stopwatch/time entry, MSP assignment, hand back; customer side shows the Co-managed section Requires current Entry/Grid application walkthrough and recorded evidence; source and component tests do not establish the browser journey.
