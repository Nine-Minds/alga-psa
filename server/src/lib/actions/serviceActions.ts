'use server'

import { revalidatePath } from 'next/cache'
import Service from 'server/src/lib/models/service'
import { IService } from 'server/src/interfaces/billing.interfaces'
import { validateArray } from 'server/src/lib/utils/validation'
import { serviceSchema } from 'server/src/lib/models/service'

export async function getServices(): Promise<IService[]> {
    try {
        const services = await Service.getAll()
        return validateArray(serviceSchema, services)
    } catch (error) {
        console.error('Error fetching services:', error)
        throw new Error('Failed to fetch services')
    }
}

export async function getServiceById(serviceId: string): Promise<IService | null> {
    try {
        const service = await Service.getById(serviceId)
        return service
    } catch (error) {
        console.error(`Error fetching service with id ${serviceId}:`, error)
        throw new Error('Failed to fetch service')
    }
}

export async function createService(
    serviceData: Omit<IService, 'service_id' | 'tenant'>
): Promise<IService> {
    try {
        console.log('[serviceActions] createService called with data:', serviceData)
        console.log('[serviceActions] service_type value:', serviceData.service_type)
        const service = await Service.create({ ...serviceData })
        console.log('[serviceActions] Service created successfully:', service)
        revalidatePath('/msp/billing') // Revalidate the billing page
        return service
    } catch (error) {
        console.error('[serviceActions] Error creating service:', error)
        throw error
    }
}

export async function updateService(
    serviceId: string,
    serviceData: Partial<IService>
): Promise<IService> {
    try {
        const updatedService = await Service.update(serviceId, serviceData);
        revalidatePath('/msp/billing'); // Revalidate the billing page

        if (updatedService === null) {
            throw new Error(`Service with id ${serviceId} not found or couldn't be updated`);
        }

        return updatedService as IService;
    } catch (error) {
        console.error(`Error updating service with id ${serviceId}:`, error);
        throw error; // Re-throw the error to be handled by the caller
    }
}

export async function deleteService(serviceId: string): Promise<void> {
    try {
        await Service.delete(serviceId)
        revalidatePath('/msp/billing') // Revalidate the billing page
    } catch (error) {
        console.error(`Error deleting service with id ${serviceId}:`, error)
        throw new Error('Failed to delete service')
    }
}

export async function getServicesByCategory(categoryId: string): Promise<IService[]> {
    try {
        const services = await Service.getByCategoryId(categoryId)
        return services
    } catch (error) {
        console.error(`Error fetching services for category ${categoryId}:`, error)
        throw new Error('Failed to fetch services by category')
    }
}
