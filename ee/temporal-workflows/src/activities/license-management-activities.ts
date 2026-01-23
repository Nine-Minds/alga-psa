/**
 * License Management Activities for Temporal Workflows
 * These activities handle license count updates from Stripe subscriptions
 */

import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import type { Knex } from 'knex';

const logger = () => Context.current().log;

export interface UpdateTenantLicenseCountInput {
  tenantId: string;
  licenseCount: number;
  eventId?: string; // Stripe event ID for idempotency
}

/**
 * Updates the tenant's licensed user count in the database
 * This activity can be called from workflows or via API endpoints
 */
export async function updateTenantLicenseCount(
  input: UpdateTenantLicenseCountInput
): Promise<void> {
  const log = logger();
  log.info('Updating tenant license count', { 
    tenantId: input.tenantId,
    licenseCount: input.licenseCount,
    eventId: input.eventId 
  });

  try {
    const knex = await getAdminConnection();
    
    await knex.transaction(async (trx: Knex.Transaction) => {
      // Check for idempotency if event ID is provided
      if (input.eventId) {
        const existing = await trx('tenants')
          .where({ 
            tenant: input.tenantId,
            stripe_event_id: input.eventId 
          })
          .first();
        
        if (existing) {
          log.info('Event already processed, skipping update', { 
            tenantId: input.tenantId,
            eventId: input.eventId 
          });
          return;
        }
      }
      
      // Update the tenant's license count
      const result = await trx('tenants')
        .where({ tenant: input.tenantId })
        .update({
          licensed_user_count: input.licenseCount,
          last_license_update: knex.fn.now(),
          stripe_event_id: input.eventId || null,
          updated_at: knex.fn.now()
        });
      
      if (result === 0) {
        throw new Error(`Tenant not found: ${input.tenantId}`);
      }
      
      log.info('Tenant license count updated successfully', { 
        tenantId: input.tenantId,
        licenseCount: input.licenseCount 
      });
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to update tenant license count', { 
      error: errorMessage,
      tenantId: input.tenantId 
    });
    throw new Error(`Failed to update license count: ${errorMessage}`);
  }
}

/**
 * Gets the current license usage for a tenant
 * Returns the limit, used count, and remaining licenses
 */
export async function getTenantLicenseUsage(tenantId: string): Promise<{
  limit: number | null;
  used: number;
  remaining: number | null;
}> {
  const log = logger();
  log.info('Getting tenant license usage', { tenantId });

  try {
    const knex = await getAdminConnection();
    
    // Get the tenant's license limit
    const tenant = await knex('tenants')
      .where({ tenant: tenantId })
      .first('licensed_user_count');
    
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }
    
    // Count active MSP (internal) users
    const usedResult = await knex('users')
      .where({ 
        tenant: tenantId,
        user_type: 'internal',
        is_inactive: false 
      })
      .count('* as count');
    
    const used = parseInt(usedResult[0].count as string, 10);
    const limit = tenant.licensed_user_count;
    const remaining = limit !== null ? Math.max(0, limit - used) : null;
    
    log.info('Tenant license usage retrieved', { 
      tenantId,
      limit,
      used,
      remaining 
    });
    
    return {
      limit,
      used,
      remaining
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to get tenant license usage', { 
      error: errorMessage,
      tenantId 
    });
    throw new Error(`Failed to get license usage: ${errorMessage}`);
  }
}