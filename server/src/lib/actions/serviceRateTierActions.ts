'use server'

import { revalidatePath } from 'next/cache'
import ServiceRateTier from 'server/src/lib/models/serviceRateTier'
import { IServiceRateTier, ICreateServiceRateTier, IUpdateServiceRateTier } from 'server/src/interfaces/serviceTier.interfaces'

/**
 * Get all rate tiers for a specific service
 */
export async function getServiceRateTiers(serviceId: string): Promise<IServiceRateTier[]> {
  try {
    const tiers = await ServiceRateTier.getByServiceId(serviceId)
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
    const tier = await ServiceRateTier.getById(tierId)
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
  try {
    console.log('[serviceRateTierActions] createServiceRateTier called with data:', tierData)
    const tier = await ServiceRateTier.create(tierData)
    console.log('[serviceRateTierActions] Rate tier created successfully:', tier)
    revalidatePath('/msp/billing') // Revalidate the billing page
    return tier
  } catch (error) {
    console.error('[serviceRateTierActions] Error creating rate tier:', error)
    throw error
  }
}

/**
 * Update an existing rate tier
 */
export async function updateServiceRateTier(
  tierId: string,
  tierData: IUpdateServiceRateTier
): Promise<IServiceRateTier | null> {
  try {
    const updatedTier = await ServiceRateTier.update(tierId, tierData)
    revalidatePath('/msp/billing') // Revalidate the billing page

    if (updatedTier === null) {
      throw new Error(`Rate tier with id ${tierId} not found or couldn't be updated`)
    }

    return updatedTier
  } catch (error) {
    console.error(`Error updating rate tier with id ${tierId}:`, error)
    throw error
  }
}

/**
 * Delete a rate tier
 */
export async function deleteServiceRateTier(tierId: string): Promise<void> {
  try {
    const success = await ServiceRateTier.delete(tierId)
    revalidatePath('/msp/billing') // Revalidate the billing page
    
    if (!success) {
      throw new Error(`Rate tier with id ${tierId} not found or couldn't be deleted`)
    }
  } catch (error) {
    console.error(`Error deleting rate tier with id ${tierId}:`, error)
    throw error
  }
}

/**
 * Delete all rate tiers for a service
 */
export async function deleteServiceRateTiersByServiceId(serviceId: string): Promise<void> {
  try {
    await ServiceRateTier.deleteByServiceId(serviceId)
    revalidatePath('/msp/billing') // Revalidate the billing page
  } catch (error) {
    console.error(`Error deleting rate tiers for service ${serviceId}:`, error)
    throw error
  }
}

/**
 * Create or update multiple rate tiers for a service
 * This will replace all existing tiers for the service
 */
export async function updateServiceRateTiers(
  serviceId: string,
  tiers: Omit<ICreateServiceRateTier, 'service_id'>[]
): Promise<IServiceRateTier[]> {
  try {
    // Delete all existing tiers for this service
    await ServiceRateTier.deleteByServiceId(serviceId)
    
    // Create new tiers
    const createdTiers: IServiceRateTier[] = []
    for (const tier of tiers) {
      const newTier = await ServiceRateTier.create({
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
}