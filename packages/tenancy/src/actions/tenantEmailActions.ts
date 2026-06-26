'use server';

import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';

/**
 * Check if a tenant with the given email exists
 * Used by the license purchase form to validate if user should add licenses vs create new account
 */
export async function checkTenantEmailExists(email: string): Promise<{
  exists: boolean;
  tenantId?: string;
}> {
  if (!email || !email.includes('@')) {
    return { exists: false };
  }

  try {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, '__tenant_email_discovery__');

    // Check if any user with this email exists (internal users only, as they're MSP users)
    const user = await db
      .unscoped('users', 'tenant discovery for license purchase internal-user email check')
      .where({
        email: email.toLowerCase(),
        user_type: 'internal'
      })
      .first('tenant', 'user_id');

    if (user) {
      return {
        exists: true,
        tenantId: user.tenant
      };
    }

    return { exists: false };
  } catch (error) {
    console.error('Error checking tenant email:', error);
    // Fail open - don't block the user
    return { exists: false };
  }
}
