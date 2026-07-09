'use server'

import { revalidatePath } from 'next/cache'
import ServiceRateTier from '../models/serviceRateTier'
import type { IServiceRateTier, ICreateServiceRateTier, IUpdateServiceRateTier } from '@alga-psa/types'
import { withTransaction } from '@alga-psa/db'
import { createTenantKnex } from '@alga-psa/db'
import { Knex } from 'knex'
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type ServiceRateTierActionError = ActionMessageError | ActionPermissionError;

function serviceRateTierActionErrorFrom(error: unknown): ServiceRateTierActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }

    if (error.message.includes('Overlapping tier ranges')) {
      return actionError('Tier ranges cannot overlap.');
    }

    if (error.message.includes('not found') || error.message.includes("couldn't be updated") || error.message.includes("couldn't be deleted")) {
      return actionError('Rate tier not found. Refresh the service and try again.');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected rate tier is invalid. Refresh the service and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required rate tier field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected service for this rate tier is no longer valid. Refresh the service and try again.');
  }

  return null;
}

/**
 * Get all rate tiers for a specific service
 */
export const getServiceRateTiers = withAuth(async (user, { tenant }, serviceId: string): Promise<IServiceRateTier[] | ServiceRateTierActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  try {
    const { knex } = await createTenantKnex()
    const tiers = await withTransaction(knex, async (trx) => {
      return await ServiceRateTier.getByServiceId(trx, serviceId)
    })
    return tiers
  } catch (error) {
    console.error(`Error fetching rate tiers for service ${serviceId}:`, error)
    const expected = serviceRateTierActionErrorFrom(error);
    if (expected) return expected;
    throw error
  }
});

/**
 * Get a specific rate tier by ID
 */
export const getServiceRateTierById = withAuth(async (user, { tenant }, tierId: string): Promise<IServiceRateTier | null | ServiceRateTierActionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  try {
    const { knex } = await createTenantKnex()
    const tier = await withTransaction(knex, async (trx) => {
      return await ServiceRateTier.getById(trx, tierId)
    })
    return tier
  } catch (error) {
    console.error(`Error fetching rate tier with id ${tierId}:`, error)
    const expected = serviceRateTierActionErrorFrom(error);
    if (expected) return expected;
    throw error
  }
});

/**
 * Create a new rate tier
 */
export const createServiceRateTier = withAuth(async (
  user,
  { tenant },
  tierData: ICreateServiceRateTier
): Promise<IServiceRateTier | ServiceRateTierActionError> => {
  if (!await hasPermission(user, 'billing', 'create')) {
    return permissionError('Permission denied: billing create required');
  }
  const { knex: db } = await createTenantKnex()
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      console.log('[serviceRateTierActions] createServiceRateTier called with data:', tierData)
      const tier = await ServiceRateTier.create(trx, tierData)
      console.log('[serviceRateTierActions] Rate tier created successfully:', tier)
      revalidatePath('/msp/billing') // Revalidate the billing page
      return tier
    } catch (error) {
      console.error('[serviceRateTierActions] Error creating rate tier:', error)
      const expected = serviceRateTierActionErrorFrom(error);
      if (expected) return expected;
      throw error
    }
  })
});

/**
 * Update an existing rate tier
 */
export const updateServiceRateTier = withAuth(async (
  user,
  { tenant },
  tierId: string,
  tierData: IUpdateServiceRateTier
): Promise<IServiceRateTier | null | ServiceRateTierActionError> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required');
  }
  const { knex: db } = await createTenantKnex()
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const updatedTier = await ServiceRateTier.update(trx, tierId, tierData)
      revalidatePath('/msp/billing') // Revalidate the billing page

      if (updatedTier === null) {
        return actionError('Rate tier not found. Refresh the service and try again.')
      }

      return updatedTier
    } catch (error) {
      console.error(`Error updating rate tier with id ${tierId}:`, error)
      const expected = serviceRateTierActionErrorFrom(error);
      if (expected) return expected;
      throw error
    }
  })
});

/**
 * Delete a rate tier
 */
export const deleteServiceRateTier = withAuth(async (user, { tenant }, tierId: string): Promise<void | ServiceRateTierActionError> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required');
  }
  const { knex: db } = await createTenantKnex()
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const success = await ServiceRateTier.delete(trx, tierId)
      revalidatePath('/msp/billing') // Revalidate the billing page

      if (!success) {
        return actionError('Rate tier not found. Refresh the service and try again.')
      }
    } catch (error) {
      console.error(`Error deleting rate tier with id ${tierId}:`, error)
      const expected = serviceRateTierActionErrorFrom(error);
      if (expected) return expected;
      throw error
    }
  })
});

/**
 * Delete all rate tiers for a service
 */
export const deleteServiceRateTiersByServiceId = withAuth(async (user, { tenant }, serviceId: string): Promise<void | ServiceRateTierActionError> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return permissionError('Permission denied: billing delete required');
  }
  const { knex: db } = await createTenantKnex()
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      await ServiceRateTier.deleteByServiceId(trx, serviceId)
      revalidatePath('/msp/billing') // Revalidate the billing page
    } catch (error) {
      console.error(`Error deleting rate tiers for service ${serviceId}:`, error)
      const expected = serviceRateTierActionErrorFrom(error);
      if (expected) return expected;
      throw error
    }
  })
});

/**
 * Create or update multiple rate tiers for a service
 * This will replace all existing tiers for the service
 */
export const updateServiceRateTiers = withAuth(async (
  user,
  { tenant },
  serviceId: string,
  tiers: Omit<ICreateServiceRateTier, 'service_id'>[]
): Promise<IServiceRateTier[] | ServiceRateTierActionError> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return permissionError('Permission denied: billing update required');
  }
  const { knex: db } = await createTenantKnex()
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Delete all existing tiers for this service
      await ServiceRateTier.deleteByServiceId(trx, serviceId)

      // Create new tiers
      const createdTiers: IServiceRateTier[] = []
      for (const tier of tiers) {
        const newTier = await ServiceRateTier.create(trx, {
          ...tier,
          service_id: serviceId
        })
        createdTiers.push(newTier)
      }

      revalidatePath('/msp/billing') // Revalidate the billing page
      return createdTiers
    } catch (error) {
      console.error(`Error updating rate tiers for service ${serviceId}:`, error)
      const expected = serviceRateTierActionErrorFrom(error);
      if (expected) return expected;
      throw error
    }
  })
});
