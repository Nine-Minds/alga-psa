import type { Knex } from 'knex';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getTenantLicenseManagementScope } from './tenant-license-state';

/**
 * An appliance credential identifies one gateway account. A workspace that licenses itself
 * independently (its own tenant claim, or a co-managed customer workspace) must not borrow it,
 * including after its own licence is removed or expires. Callers invoke this only on the
 * self-hosted path, immediately before using the installation credential, so hosted tenants and
 * ordinary self-hosted tenants behave exactly as before. No tenant-owned gateway connection exists yet.
 */
export async function assertInstallationAiCredentialAllowed(tenant: string, connection?: Knex): Promise<void> {
  if (typeof tenant !== 'string' || !tenant.trim()) throw new Error('A tenant identity is required for AI gateway authentication');
  const scope = await getTenantLicenseManagementScope(connection ?? await getAdminConnection(), tenant);
  if (scope !== 'installation') throw new Error('This workspace requires its own AI gateway connection');
}
