/** Source locations for a current-branch census, never acceptance evidence. */
const bootstrap = 'ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts';
const core = name => `packages/co-managed/src/${name}.ts`;
const ui = name => `server/src/components/co-managed/${name}.tsx`;
const test = name => `server/src/test/unit/product/${name}`;
const domain = (sources, tests, remaining) => ({ sources, tests, remaining });

const domains = {
  product: domain(['server/src/lib/productSurfaceRegistry.ts', 'server/migrations/utils/permissions/catalog.cjs'],
    [test('coManagedProductSurface.test.ts')], 'Complete product/role/entry-point acceptance; source and unit coverage do not establish every operational UI/API journey.'),
  purchase: domain(['packages/licensing/src/lib/co-managed-purchases.ts', 'server/src/components/co-managed/useCoManagedPurchaseController.ts'],
    ['server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts', test('coManagedPoolEditor.test.tsx')], 'Run the required application/provider purchase and reconciliation journey; real Stripe price/payment acceptance needs release-owner credentials.'),
  license: domain(['packages/licensing/src/lib/co-managed-license.ts', 'packages/licensing/src/lib/co-managed-entitlements.ts'],
    ['packages/licensing/src/lib/co-managed-license.test.ts', bootstrap], 'Exercise normal signed-license import/refresh and independent upgrade controls; raw entitlement fixtures alone do not satisfy the signed-license journey.'),
  allocation: domain(['packages/licensing/src/lib/co-managed-admission.ts', 'packages/licensing/src/lib/co-managed-reservation.ts'],
    ['server/src/test/integration/coManagedReservations.integration.test.ts', bootstrap], 'Attach candidate-specific capacity/race results to this requirement and complete its required hosted/self-host controls.'),
  provision: domain([core('provisioning'), core('acceptance'), ui('CoManagedClientSetup')],
    [bootstrap, test('coManagedAcceptanceActions.test.ts')], 'Complete fresh-client invitation/setup/acceptance through the application and actual delivery/worker composition; database fixtures cover only part of the journey.'),
  isolation: domain([core('sharedWork'), core('customerWork'), core('sharedWorkRead')],
    [bootstrap, test('coManagedSharedWorkActions.test.ts')], 'Complete the full two-session API/search/download/realtime/queued-delivery matrix; a ticket collision regression covers only part of it.'),
  delegation: domain([core('delegatedAdministration'), ui('CoManagedDelegatedAdministration')],
    [bootstrap, test('coManagedDelegatedAdministrationActions.test.ts')], 'Complete customer-approved delegation and revoked-scope application journeys; source presence cannot accept these scenarios.'),
  handoff: domain([core('ticketHandoffs'), core('ticketEditing'), ui('CoManagedTicketSection')],
    [bootstrap, test('coManagedTicketSection.test.tsx')], 'Complete the normal application handoff/retry/close/reopen journey with canonical ownership and qualified mapping evidence.'),
  conversation: domain([core('ticketConversation'), core('ticketCommentCreation'), core('conversationAttachments')],
    [bootstrap, test('coManagedTicketCommentActions.test.ts')], 'Complete requester/shared/private admission through application, portal, files and queued consumers; automated service cases are partial evidence.'),
  queue: domain([core('ticketQueue'), ui('QualifiedTicketList'), 'packages/tickets/src/lib/ticketListScope.ts'],
    [bootstrap, test('qualifiedTicketList.test.tsx'), test('coManagedTicketQueueActions.test.ts')], 'Complete actual list/count/export and navigation acceptance using duplicate qualified identities and current grants.'),
  project: domain([core('projectTaskEditing'), core('projectTaskQueue'), ui('CoManagedProjectTaskEditor')],
    [bootstrap, test('coManagedProjectTaskEditor.test.tsx')], 'Complete actual shared-task picker, collaboration and revocation journeys; retain unshared-project denial.'),
  time: domain([core('nativeTimeDispatch'), core('nativeTimeSheetList'), core('timeBillingProfile')],
    [bootstrap, test('coManagedTimeEntry.test.tsx')], 'Complete native grid/detail/export/approval/invoice application journeys and confirm totals/privacy; service tests do not establish screen usability.'),
  sla: domain([core('ticketSla'), ui('CoManagedSlaPolicyPanel')],
    [bootstrap, test('coManagedOrganizationSlaClock.test.ts')], 'Exercise escalation/reply/handback/close/reopen with both running SLA backends and duplicate consumer delivery.'),
  lifecycle: domain(['packages/licensing/src/lib/co-managed-lifecycle.ts', core('inboundRequesterReply')],
    [bootstrap, 'server/src/test/unit/email/coManagedAdmissionAdapters.test.ts'], 'Complete original-deadline lapse and once-only renewal through both deployed worker compositions.'),
  portable: domain([core('portableExport'), core('portableTransfer'), ui('CoManagedPortableExport')],
    [bootstrap, test('coManagedPortableExport.test.tsx')], 'Complete source-unavailable export/restore through native screens; compare permitted records/files/credentials and prove tamper/interruption recovery.'),
  upgrade: domain([core('independentUpgrade'), ui('CoManagedUpgrade')],
    [bootstrap, test('coManagedUpgrade.test.tsx')], 'Complete hosted/signed-license independent upgrade through normal controls and exactly-once release/activation recovery.'),
  archive: domain([core('archiveReads'), core('departure'), core('relationshipClosure')],
    [bootstrap, test('coManagedArchive.test.tsx')], 'Exercise actual customer deletion and retained MSP invoice/archive access; PostgreSQL/Citus runtime invariants need their own acceptance.'),
  flag: domain([ui('CoManagedFeatureBoundary'), 'server/src/app/msp/MspLayoutClient.tsx'],
    [test('coManagedFeatureBoundary.test.tsx'), test('coManagedT21Boundary.contract.test.ts')], 'Complete real flag-off/direct-route/portal and backend-authority matrix; ordinary PSA/AlgaDesk fallback must remain usable.'),
  providers: domain([ui('CoManagedProviderSetup'), 'server/src/lib/productSurfaceRegistry.ts'],
    [test('providerSetupReachability.test.ts'), bootstrap], 'Complete customer-owned provider setup/save/reload/OAuth and directory vendor-event flow through normal controls and real consumers.'),
  oidc: domain(['packages/auth/src/lib/sso/microsoftSsoEmulator.ts', 'packages/auth/src/lib/nextAuthOptions.ts', 'packages/emulators/msgraph/src/wire.ts', 'packages/emulators/msgraph/src/core.ts', 'packages/emulators/msgraph/src/entraOidc.ts'],
    ['packages/auth/src/lib/sso/microsoftSsoEmulator.test.ts', 'packages/emulators/msgraph/tests/entraOidc.test.ts'], 'Complete the Alga customer tenant-resolution/account-linking journey on the deployed runtime as well as signed Entra discovery/JWKS/PKCE and Auth.js protocol/session checks; protocol tests alone do not establish it.'),
  intake: domain([core('inboundRequesterReply'), 'shared/services/email/inboundEmailCoreProcessor.ts'],
    [bootstrap, 'server/src/test/unit/email/coManagedAdmissionAdapters.test.ts'], 'Focused PostgreSQL lifecycle cases exist. Original-order CI and running-worker deferred-source replay are distinct remaining acceptance obligations.'),
  client: domain([core('managementPolicy'), ui('CoManagedClientIntegration'), ui('CoManagedClientView')],
    [bootstrap, test('coManagedClientIntegration.test.tsx'), test('coManagedClientManagement.test.tsx')], 'Complete client page/drawer/legacy/role/draft application acceptance; component/service proofs do not establish all browser states.'),
  presentation: domain([ui('QualifiedTicketList'), ui('CoManagedClientIntegration'), ui('CoManagedTicketSection')],
    [test('qualifiedTicketList.test.tsx'), test('coManagedClientIntegration.test.tsx')], 'Complete translated light/dark/narrow/keyboard/focus browser acceptance and retain the required revision-specific evidence.'),
  picker: domain([ui('CoManagedAssignmentField'), ui('CoManagedProjectTaskAssignment')],
    [test('coManagedTicketAssignmentActions.test.ts'), test('coManagedProjectTaskEditor.test.tsx')], 'Demonstrate the real hydrated team/person picker with pointer and keyboard; action/SQL assignment is not that proof.'),
  migrations: domain(['server/migrations/20260906010000_create_co_management_foundation.cjs', 'server/migrations/utils/citusDistribution.cjs'],
    [bootstrap], 'Execute fresh/populated-upgrade/rollback and distributed Citus mutation invariants; a PostgreSQL schema clone is not a Citus installation or upgrade.'),
  runtime: domain(['docs/dev/co-managed-review-services.md', 'scripts/dev/run-co-managed-dev-server.sh'],
    [bootstrap], 'Requires current app/worker build provenance, authenticated walkthrough and 30 minutes without healing; unit/service tests do not establish runtime stability.'),
  fixtures: domain(['scripts/dev/co-managed-fixtures.ts', 'docs/dev/co-managed-fixtures.md'],
    [bootstrap], 'Requires fixture reset/apply/reapply and current application/DB evidence. Disposable test fixtures are not the review-stack reset/stability proof.'),
  builds: domain(['server/package.json', 'ee/temporal-workflows/package.json'],
    [test('coManagedFeatureBoundary.test.tsx')], 'Requires affected local typechecks/regressions, CE/EE builds and exact-candidate CI/mergeability acceptance; local test counts do not establish CI success.'),
  gate: domain(['scripts/lib/co-managed-plan-ids.mjs', 'scripts/lib/co-managed-completion.mjs', 'scripts/build-co-managed-inventory.mjs'],
    ['scripts/tests/co-managed-plan-ids.test.mjs', 'scripts/tests/co-managed-completion.test.mjs'], 'Gate behavior is tested; actual-candidate acceptance cannot pass until every required evidence obligation is met. Do not relax the gate or convert a source census into acceptance.'),
  packet: domain(['docs/evidence/co-managed-completion/README.md', 'scripts/verify-co-managed-completion.mjs'],
    ['scripts/tests/co-managed-completion.test.mjs'], 'Requires final PR/guide/recording/runtime/CI packet reconciliation and the actual-candidate verifier verdict before human-review readiness.'),
};

const foundation = ['product', 'purchase', 'license', 'allocation', 'provision', 'isolation', 'delegation', 'handoff', 'conversation', 'handoff', 'queue', 'project', 'time', 'time', 'sla', 'isolation', 'lifecycle', 'portable', 'upgrade', 'archive', 'flag', 'flag'];
const correction = ['gate', 'intake', 'intake', 'intake', 'providers', 'providers', 'oidc', 'intake', 'providers', 'provision', 'queue', 'queue', 'queue', 'queue', 'presentation', 'picker', 'time', 'time', 'isolation', 'lifecycle', 'sla', 'purchase', 'license', 'portable', 'archive', 'migrations', 'runtime', 'fixtures', 'builds', 'gate', 'packet', 'packet'];
const correctionTests = ['gate', 'intake', 'intake', 'intake', 'intake', 'providers', 'provision', 'oidc', 'providers', 'queue', 'queue', 'queue', 'presentation', 'time', 'isolation', 'lifecycle', 'sla', 'purchase', 'license', 'portable', 'archive', 'migrations', 'runtime', 'fixtures', 'builds', 'gate'];

export function requirementSources(plan, row) {
  const n = Number(row.id.replace(/\D/g, ''));
  let name;
  if (plan === 'foundation') name = foundation[n - 1];
  else if (plan === 'correction') name = (row.id.startsWith('CT') ? correctionTests : correction)[n - 1];
  else if (plan === 'clientIntegration') name = row.id.startsWith('T')
    ? (n >= 18 && n <= 19 ? (n === 18 ? 'purchase' : 'license') : n === 21 ? 'presentation' : 'client')
    : n >= 19 && n <= 26 ? 'purchase' : n === 29 || n === 30 ? 'queue' : n === 31 ? 'flag' : n === 32 ? 'presentation' : 'client';
  else if (plan === 'ticketList') name = n === 38 && row.id.startsWith('F') || n === 19 && row.id.startsWith('T') ? 'presentation' : 'queue';
  else if (plan === 'nativeTicketScreen') {
    const sources = ['packages/tickets/src/lib/ticketDataSource.ts', ui('sharedTicketDataSource'), ui('SharedTicketScreen')];
    const tests = [test('coManagedSharedTicketDataSource.test.tsx'), bootstrap];
    return domain(sources, tests, row.id === 'T014'
      ? 'Requires current Entry/Grid application walkthrough and recorded evidence; source and component tests do not establish the browser journey.'
      : 'Attach the exact native/shared capability, read/write, route or locale acceptance named by this row; source presence is not an executed acceptance record.');
  }
  if (!domains[name]) throw new Error(`No source census mapping for ${plan}:${row.id}`);
  return domains[name];
}
