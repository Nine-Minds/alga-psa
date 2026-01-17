'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';
import { getTenantForCurrentRequest } from 'server/src/lib/tenant';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { importReferenceData } from 'server/src/lib/actions/referenceDataActions';

export async function getStandardServiceTypes(): Promise<{
  success: boolean;
  data?: Array<{ id: string; name: string; billing_method: string; display_order?: number }>;
  error?: string;
}> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    // Use getAvailableReferenceData to only get types that haven't been imported
    const { getAvailableReferenceData } = await import('../referenceDataActions');
    const availableTypes = await getAvailableReferenceData('service_types');
    
    return {
      success: true,
      data: availableTypes || []
    };
  } catch (error) {
    console.error('Error getting standard service types:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function importServiceTypes(typeIds: string[]): Promise<{
  success: boolean;
  data?: { imported: number; skipped: number };
  error?: string;
}> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const result = await importReferenceData('service_types', typeIds);
    
    return {
      success: true,
      data: {
        imported: result.imported?.length || 0,
        skipped: result.skipped?.length || 0
      }
    };
  } catch (error) {
    console.error('Error importing service types:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function getTenantServiceTypes(): Promise<{
  success: boolean;
  data?: Array<{ id: string; name: string; billing_method: string; order_number?: number }>;
  error?: string;
}> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'No authenticated user found' };
    }

    const tenant = await getTenantForCurrentRequest();
    if (!tenant) {
      return { success: false, error: 'No tenant found' };
    }

    const { knex } = await createTenantKnex();
    
    const serviceTypes = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('service_types')
        .where({ 
          tenant: tenant,
          is_active: true
        })
        .select('id', 'name', 'billing_method', 'order_number')
        .orderBy('name');
    });

    return {
      success: true,
      data: serviceTypes
    };
  } catch (error) {
    console.error('Error getting tenant service types:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}