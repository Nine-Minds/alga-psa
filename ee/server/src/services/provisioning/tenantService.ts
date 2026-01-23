import { getAdminConnection } from '@alga-psa/db/admin';
import { CreateTenantInput, TenantResponse } from './types/tenant.schema';
import { Knex } from 'knex';

export class TenantProvisioningError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'TenantProvisioningError';
  }
}

export class TenantService {
  /**
   * Creates a new tenant with the provided details
   */
  static async createTenant(input: CreateTenantInput): Promise<TenantResponse> {
    const knex = await getAdminConnection();

    try {
      // Start a transaction to ensure data consistency
      const result = await knex.transaction(async (trx: Knex.Transaction) => {
        // Create the tenant record
        const [tenant] = await trx('tenants')
          .insert({
            client_name: input.client_name,
            email: input.email,
            phone_number: input.phone_number,
            industry: input.industry,
            plan: input.plan,
            tax_id_number: input.tax_id_number
          })
          .returning('*');

        if (!tenant) {
          throw new TenantProvisioningError('Failed to create tenant record');
        }

        return tenant;
      });

      return {
        tenant: result.tenant,
        client_name: result.client_name,
        email: result.email,
        phone_number: result.phone_number,
        industry: result.industry,
        plan: result.plan,
        tax_id_number: result.tax_id_number,
        created_at: new Date(result.created_at),
        updated_at: new Date(result.updated_at)
      };
    } catch (error) {
      if (error instanceof TenantProvisioningError) {
        throw error;
      }

      // Handle unique constraint violations
      if (error instanceof Error && error.message.includes('unique constraint')) {
        throw new TenantProvisioningError(
          'A tenant with this email already exists',
          error
        );
      }

      // Log the error for debugging
      console.error('Tenant provisioning error:', error);
      throw new TenantProvisioningError(
        'An error occurred while creating the tenant',
        error
      );
    }
  }
}
