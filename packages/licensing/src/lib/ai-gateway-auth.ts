import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getTenantLicenseManagementScope } from './tenant-license-state';

/** An appliance credential identifies one gateway account. Customer workspaces
 * cannot borrow it, including after departure or removal of their paid license.
 * No tenant-owned self-host gateway connection is implemented yet. */
export async function getSelfHostAiGatewayCredential(tenant: string, connection?: Knex): Promise<string | null> {
  if (typeof tenant !== 'string' || !tenant.trim()) throw new Error('A tenant identity is required for AI gateway authentication');
  const db = connection ?? await getAdminConnection();
  return withTransaction(db, async trx => {
    // Read the singleton directly: isSelfHostLicensing is a presentation helper
    // whose database-error fallback must never mint a hosted gateway credential.
    const installation = await trx('license_state').orderBy('id').forShare().first('appliance_credential');
    if (!installation) return null;
    const owner = await tenantDb(trx, tenant).table('tenants').forShare().first('tenant');
    if (!owner) throw new Error('AI gateway workspace is not available');
    const scope = await getTenantLicenseManagementScope(trx, tenant);
    if (scope !== 'installation') throw new Error('This workspace requires its own AI gateway connection');
    const credential = installation.appliance_credential?.trim();
    if (!credential) throw new Error('AI gateway authentication requires an appliance credential on self-hosted installs');
    return credential;
  });
}
