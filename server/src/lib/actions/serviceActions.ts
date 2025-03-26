'use server'

import { revalidatePath } from 'next/cache'
import Service from 'server/src/lib/models/service'
import { IService, IServiceType } from '../../interfaces/billing.interfaces'; // Added IServiceType import
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
        console.log('[serviceActions] service_type_id value:', serviceData.service_type_id) // Changed from service_type
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

// New action to get combined service types for UI selection
export async function getServiceTypesForSelection(): Promise<(IServiceType & { is_standard?: boolean })[]> {
   try {
       // Assuming ServiceTypeModel is imported or available
       // Need to import ServiceTypeModel from '../models/serviceType'
       const { ServiceTypeModel } = await import('../models/serviceType');
       const serviceTypes = await ServiceTypeModel.findAllIncludingStandard();
       // No validation needed here as it's directly from the model method designed for this
       return serviceTypes;
   } catch (error) {
       console.error('Error fetching service types for selection:', error);
       throw new Error('Failed to fetch service types');
   }
}

// --- CRUD Actions for Tenant-Specific Service Types ---

export async function createServiceType(
  data: Omit<IServiceType, 'id' | 'created_at' | 'updated_at' | 'tenant'>
): Promise<IServiceType> {
  try {
      // Assuming ServiceTypeModel is imported or available
      const { ServiceTypeModel } = await import('../models/serviceType');
      // Tenant context is handled within the model method
      const newServiceType = await ServiceTypeModel.create(data);
      // Optionally revalidate paths if there's a UI for managing these
      // revalidatePath('/path/to/service/type/management');
      return newServiceType;
  } catch (error) {
      console.error('Error creating service type:', error);
      throw new Error('Failed to create service type');
  }
}

export async function updateServiceType(
  id: string,
  data: Partial<Omit<IServiceType, 'id' | 'tenant_id' | 'created_at' | 'updated_at' | 'tenant'>>
): Promise<IServiceType> {
  try {
      // Assuming ServiceTypeModel is imported or available
      const { ServiceTypeModel } = await import('../models/serviceType');
      // Tenant context is handled within the model method
      const updatedServiceType = await ServiceTypeModel.update(id, data);
      if (!updatedServiceType) {
          throw new Error(`Service type with id ${id} not found or could not be updated.`);
      }
      // Optionally revalidate paths
      // revalidatePath('/path/to/service/type/management');
      return updatedServiceType;
  } catch (error) {
      console.error(`Error updating service type ${id}:`, error);
      throw new Error('Failed to update service type');
  }
}

export async function deleteServiceType(id: string): Promise<void> {
  try {
      // Assuming ServiceTypeModel is imported or available
      const { ServiceTypeModel } = await import('../models/serviceType');
      // Tenant context is handled within the model method
      const deleted = await ServiceTypeModel.delete(id);
      if (!deleted) {
          // Optionally handle the case where the type wasn't found
          console.warn(`Attempted to delete service type ${id}, but it was not found.`);
      }
      // Optionally revalidate paths
      // revalidatePath('/path/to/service/type/management');
  } catch (error) {
      console.error(`Error deleting service type ${id}:`, error);
      throw new Error('Failed to delete service type');
  }
}
