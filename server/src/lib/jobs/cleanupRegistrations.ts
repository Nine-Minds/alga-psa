'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { logSecurityEvent } from 'server/src/lib/security/rateLimiting';

export async function cleanupExpiredRegistrations(): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant is required');

  try {
    // Get expired registrations
    const expiredRegistrations = await knex('pending_registrations')
      .where('expires_at', '<', new Date().toISOString())
      .andWhere('status', 'PENDING_VERIFICATION')
      .select('registration_id', 'email');

    if (expiredRegistrations.length === 0) {
      return;
    }

    // Update status to EXPIRED
    await knex.transaction(async (trx) => {
      // Update registration status
      await trx('pending_registrations')
        .whereIn('registration_id', expiredRegistrations.map(r => r.registration_id))
        .update({
          status: 'EXPIRED',
          updated_at: new Date().toISOString()
        });

      // Log cleanup events
      for (const registration of expiredRegistrations) {
        await logSecurityEvent(tenant, 'registration_expired', {
          email: registration.email,
          registrationId: registration.registration_id
        });
      }
    });

    console.log(`Cleaned up ${expiredRegistrations.length} expired registrations`);
  } catch (error) {
    console.error('Error cleaning up expired registrations:', error);
    throw error;
  }
}

export async function cleanupExpiredTokens(): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant is required');

  try {
    // Get expired tokens
    const expiredTokens = await knex('verification_tokens')
      .where('expires_at', '<', new Date().toISOString())
      .andWhere('used_at', null)
      .select('token_id', 'registration_id');

    if (expiredTokens.length === 0) {
      return;
    }

    // Delete expired tokens
    await knex('verification_tokens')
      .whereIn('token_id', expiredTokens.map(t => t.token_id))
      .delete();

    console.log(`Cleaned up ${expiredTokens.length} expired tokens`);
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error);
    throw error;
  }
}

// Schedule cleanup jobs
export async function scheduleCleanupJobs(): Promise<void> {
  // Run cleanup every hour
  setInterval(async () => {
    try {
      await cleanupExpiredRegistrations();
      await cleanupExpiredTokens();
    } catch (error) {
      console.error('Error running cleanup jobs:', error);
    }
  }, 60 * 60 * 1000); // 1 hour
}
