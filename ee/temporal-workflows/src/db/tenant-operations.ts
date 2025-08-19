import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import type { Knex } from 'knex';
import type {
  CreateTenantActivityInput,
  CreateTenantActivityResult,
  SetupTenantDataActivityInput,
  SetupTenantDataActivityResult
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

/**
 * Create a new tenant in the main application database
 */
export async function createTenantInDB(
  input: CreateTenantActivityInput
): Promise<CreateTenantActivityResult> {
  const log = logger();
  log.info('Creating tenant in database', { tenantName: input.tenantName });

  try {
    const knex = await getAdminConnection();
    
    const result = await knex.transaction(async (trx: Knex.Transaction) => {
      // Create tenant first (include admin email since it's required)
      const tenantResult = await trx('tenants')
        .insert({
          company_name: input.tenantName,
          email: input.email,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now()
        })
        .returning('tenant');
      
      const tenantId = tenantResult[0].tenant;
      log.info('Tenant created successfully', { tenantId });

      // Create company if companyName is provided (now with tenant ID)
      let companyId: string | undefined;
      
      if (input.companyName) {
        const companyResult = await trx('companies')
          .insert({
            company_name: input.companyName,
            tenant: tenantId,
            client_type: 'company',
            is_inactive: false,
            properties: {
              type: 'msp',
              is_system_company: true,
              created_by: 'tenant_setup'
            },
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('company_id');
        companyId = companyResult[0].company_id;
        log.info('Company created', { companyId, companyName: input.companyName, tenantId });
        
        // Create default location for the MSP company with email from the tenant setup
        // IMPORTANT: location_id must be provided as it's not nullable in the database
        await trx('company_locations')
          .insert({
            location_id: knex.raw('gen_random_uuid()'),
            company_id: companyId,
            tenant: tenantId,
            location_name: 'Main Office',
            email: input.email,  // Use the admin email as the default contact email
            phone: '',
            address_line1: '',
            is_default: true,
            is_active: true,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });
        log.info('Default location created', { companyId, email: input.email });
        
        // Note: Not updating tenant with company_id as column doesn't exist in schema
      }

      return { tenantId, companyId };
    });

    return {
      tenantId: result.tenantId,
      companyId: result.companyId,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to create tenant', { error: errorMessage });
    throw new Error(`Failed to create tenant: ${errorMessage}`);
  }
}

/**
 * Set up initial tenant data (billing plans, default settings, etc.)
 */
export async function setupTenantDataInDB(
  input: SetupTenantDataActivityInput
): Promise<SetupTenantDataActivityResult> {
  const log = logger();
  log.info('Setting up tenant data', { tenantId: input.tenantId });

  try {
    const knex = await getAdminConnection();
    const setupSteps: string[] = [];

    await knex.transaction(async (trx: Knex.Transaction) => {
      // Set up tenant email settings with defaults (simple insert, no ON CONFLICT to avoid distributed table issues)
      try {
        await trx('tenant_email_settings')
          .insert({
            tenant_id: input.tenantId,
            email_provider: 'resend',
            fallback_enabled: true,
            tracking_enabled: false
          });
        setupSteps.push('email_settings');
      } catch (error) {
        // If it already exists, that's fine
        log.info('Tenant email settings already exist, skipping', { tenantId: input.tenantId });
      }

      // Initialize tenant settings with onboarding flags set to false
      try {
        await trx('tenant_settings')
          .insert({
            tenant: input.tenantId,
            onboarding_completed: false,
            onboarding_skipped: false,
            onboarding_data: null,
            settings: null,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });
        setupSteps.push('tenant_settings');
      } catch (error) {
        // If it already exists, that's fine
        log.info('Tenant settings already exist, skipping', { tenantId: input.tenantId });
      }

      // Create tenant-company association if we have a company
      if (input.companyId) {
        try {
          await trx('tenant_companies')
            .insert({
              tenant: input.tenantId,
              company_id: input.companyId,
              is_default: true
            });
          setupSteps.push('tenant_company_association');
        } catch (error) {
          // If it already exists, that's fine
          log.info('Tenant-company association already exists, skipping', { tenantId: input.tenantId, companyId: input.companyId });
        }
      }

      log.info('Tenant data setup steps completed', { tenantId: input.tenantId, setupSteps });
    });

    log.info('Tenant data setup completed', { 
      tenantId: input.tenantId, 
      setupSteps: setupSteps.length 
    });

    return {
      setupSteps,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to setup tenant data', { error: errorMessage });
    throw new Error(`Failed to setup tenant data: ${errorMessage}`);
  }
}

/**
 * Rollback tenant creation (for error handling)
 */
export async function rollbackTenantInDB(tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back tenant creation', { tenantId });

  try {
    const knex = await getAdminConnection();

    await knex.transaction(async (trx: Knex.Transaction) => {
      // Delete in proper order to avoid foreign key violations
      
      // Delete user roles first (references users)
      await trx('user_roles').where({ tenant: tenantId }).delete();
      
      // Delete users (references tenant)
      await trx('users').where({ tenant: tenantId }).delete();
      
      // Delete tenant_companies associations (references tenant and companies)
      await trx('tenant_companies').where({ tenant: tenantId }).delete();
      
      // Delete tenant_email_settings (references tenant indirectly)
      await trx('tenant_email_settings').where({ tenant_id: tenantId }).delete();
      
      // Delete tenant_settings (references tenant)
      await trx('tenant_settings').where({ tenant: tenantId }).delete();
      
      // Delete companies (references tenant)
      await trx('companies').where({ tenant: tenantId }).delete();
      
      // Delete the tenant last
      await trx('tenants').where({ tenant: tenantId }).delete();
    });

    log.info('Tenant rollback completed', { tenantId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to rollback tenant', { error: errorMessage, tenantId });
    // Don't throw here - rollback failures shouldn't mask the original error
  }
}