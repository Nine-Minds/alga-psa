'use server'

import { revalidatePath } from 'next/cache'
import ServiceRateTier from '@/lib/models/serviceRateTier'
import { IServiceRateTier, ICreateServiceRateTier, IUpdateServiceRateTier } from '@/interfaces/serviceTier.interfaces'
import { withTransaction } from '@alga-psa/shared/db'
import { createTenantKnex } from '@server/lib/db'
import { Knex } from 'knex'

/**
 * Get all rate tiers for a specific service
 */
export async function getServiceRateTiers(serviceId: string): Promise<IServiceRateTier[]> {
  try {
    const { knex } = await createTenantKnex()
    const tiers = await ServiceRateTier.getByServiceId(knex, serviceId)
    return tiers
  } catch (error) {
    console.error(`Error fetching rate tiers for service ${serviceId}:`, error)
    throw new Error('Failed to fetch service rate tiers')
  }
}

/**
 * Get a specific rate tier by ID
 */
export async function getServiceRateTierById(tierId: string): Promise<IServiceRateTier | null> {
  try {
    const { knex } = await createTenantKnex()
    const tier = await ServiceRateTier.getById(knex, tierId)
    return tier
  } catch (error) {
    console.error(`Error fetching rate tier with id ${tierId}:`, error)
    throw new Error('Failed to fetch rate tier')
  }
}

/**
 * Create a new rate tier
 */
export async function createServiceRateTier(
  tierData: ICreateServiceRateTier
): Promise<IServiceRateTier> {
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
      throw error
    }
  })
}

/**
 * Update an existing rate tier
 */
export async function updateServiceRateTier(
  tierId: string,
  tierData: IUpdateServiceRateTier
): Promise<IServiceRateTier | null> {
  const { knex: db } = await createTenantKnex()
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const updatedTier = await ServiceRateTier.update(trx, tierId, tierData)
      revalidatePath('/msp/billing') // Revalidate the billing page

      if (updatedTier === null) {
        throw new Error(`Rate tier with id ${tierId} not found or couldn't be updated`)
      }

      return updatedTier
    } catch (error) {
      console.error(`Error updating rate tier with id ${tierId}:`, error)
      throw error
    }
  })
}

/**
 * Delete a rate tier
 */
export async function deleteServiceRateTier(tierId: string): Promise<void> {
  const { knex: db } = await createTenantKnex()
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const success = await ServiceRateTier.delete(trx, tierId)
      revalidatePath('/msp/billing') // Revalidate the billing page
      
      if (!success) {
        throw new Error(`Rate tier with id ${tierId} not found or couldn't be deleted`)
      }
    } catch (error) {
      console.error(`Error deleting rate tier with id ${tierId}:`, error)
      throw error
    }
  })
}

/**
 * Delete all rate tiers for a service
 */
export async function deleteServiceRateTiersByServiceId(serviceId: string): Promise<void> {
  const { knex: db } = await createTenantKnex()
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      await ServiceRateTier.deleteByServiceId(trx, serviceId)
      revalidatePath('/msp/billing') // Revalidate the billing page
    } catch (error) {
      console.error(`Error deleting rate tiers for service ${serviceId}:`, error)
      throw error
    }
  })
}

/**
 * Create or update multiple rate tiers for a service
 * This will replace all existing tiers for the service
 */
export async function updateServiceRateTiers(
  serviceId: string,
  tiers: Omit<ICreateServiceRateTier, 'service_id'>[]
): Promise<IServiceRateTier[]> {
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
      throw error
    }
  })
}