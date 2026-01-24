'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { importReferenceData, getAvailableReferenceData } from '@alga-psa/reference-data/actions';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

export const getStandardServiceTypes = withAuth(async (
  _user: IUserWithRoles,
  _ctx: AuthContext
): Promise<{
  success: boolean;
  data?: Array<{ id: string; name: string; billing_method: string; display_order?: number }>;
  error?: string;
}> => {
  try {
    // Use getAvailableReferenceData to only get types that haven't been imported
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
});

export const importServiceTypes = withAuth(async (
  _user: IUserWithRoles,
  _ctx: AuthContext,
  typeIds: string[]
): Promise<{
  success: boolean;
  data?: { imported: number; skipped: number };
  error?: string;
}> => {
  try {
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
});

export const getTenantServiceTypes = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<{
  success: boolean;
  data?: Array<{ id: string; name: string; billing_method: string; order_number?: number }>;
  error?: string;
}> => {
  try {
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
});

export const createTenantServiceType = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext,
  input: {
    name: string;
    description: string | null;
    billing_method: 'fixed' | 'hourly' | 'usage';
    is_active: boolean;
    order_number: number;
  }
): Promise<{ success: boolean; data?: { id: string }; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();

    const inserted = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const [row] = await trx('service_types')
        .insert({
          tenant,
          name: input.name,
          description: input.description,
          billing_method: input.billing_method,
          is_active: input.is_active,
          order_number: input.order_number,
        })
        .returning(['id']);
      return row as { id: string };
    });

    return { success: true, data: { id: inserted.id } };
  } catch (error) {
    console.error('Error creating tenant service type:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});
