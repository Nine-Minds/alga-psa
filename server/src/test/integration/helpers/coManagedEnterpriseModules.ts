import { createRequire } from 'node:module';

// The co-managed bootstrap suite executes Temporal activities and workflows, so
// it runs from ee/temporal-workflows/src/__tests__/integration rather than from
// server/src/test/integration — a server-side import of the worker would close a
// server -> temporal-workflows cycle. The worker project must not gain the
// reverse reach into ee/server either, so the enterprise modules that suite
// exercises are loaded through server/, which already depends on ee/server.
// LEVERAGE: friction ee-test-reach — every cross-project test reach is re-derived
// as a relative path per suite; there is no test-facing module seam to ask for one.
export const importCoManagedPortableWorkspaceExport = () =>
  import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceExport');
export const importCoManagedPortableWorkspaceRestoreVault = () =>
  import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestoreVault');
export const importCoManagedPortableWorkspaceRestoreDatabase = () =>
  import('../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestoreDatabase');
export const importCoManagedPortableVaultExport = () =>
  import('../../../../../ee/server/src/lib/co-managed/portableVaultExport');
export const importApplianceLicenseSeatGuard = () =>
  import('../../../../../ee/server/src/lib/license/userSeatGuard');
export const importCoManagedUpgradeActions = () =>
  import('../../../../../ee/server/src/lib/actions/coManagedUpgradeActions');
export const importTenantManagementWorkflowClient = () =>
  import('../../../../../ee/server/src/lib/tenant-management/workflowClient');
export const importCoManagedUpgradeCheckout = () =>
  import('../../../../../ee/server/src/lib/stripe/coManagedUpgradeCheckout');
export const importStripeService = () =>
  import('../../../../../ee/server/src/lib/stripe/StripeService');
export const importCredentialEncryption = () =>
  import('../../../../../ee/server/src/lib/credentials/encryption');
export const importPortableCredentialVault = () =>
  import('../../../../../ee/server/src/lib/credentials/portable');

const requireEnterprise = createRequire(import.meta.url);
export const requireCoManagedProjectStatusSeed = () =>
  requireEnterprise('../../../../../ee/server/seeds/onboarding/co_managed/05_project_statuses.cjs');
