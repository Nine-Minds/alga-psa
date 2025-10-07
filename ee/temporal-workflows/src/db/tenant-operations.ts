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
  log.info('Creating tenant in database', { 
    tenantName: input.tenantName,
    licenseCount: input.licenseCount 
  });

  try {
    const knex = await getAdminConnection();
    
    const result = await knex.transaction(async (trx: Knex.Transaction) => {
      // Create tenant first (include admin email since it's required)
      const tenantCompanyName = input.companyName ?? input.tenantName;

      const tenantData: any = {
        client_name: tenantCompanyName,
        email: input.email.toLowerCase(),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      };
      
      // Add license count if provided
      if (input.licenseCount !== undefined) {
        tenantData.licensed_user_count = input.licenseCount;
        tenantData.last_license_update = knex.fn.now();
        tenantData.stripe_event_id = `temporal_${Date.now()}`; // Track that this came from Temporal
      }
      
      const tenantResult = await trx('tenants')
        .insert(tenantData)
        .returning('tenant');
      
      const tenantId = tenantResult[0].tenant;
      log.info('Tenant created successfully', {
        tenantId,
        licenseCount: input.licenseCount
      });

      // Create client if name is provided (now with tenant ID)
      let clientId: string | undefined;

      const clientName = input.clientName ?? input.companyName;

      if (clientName) {
        const clientResult = await trx('clients')
          .insert({
            client_name: clientName,
            tenant: tenantId,
            client_type: 'client',
            is_inactive: false,
            properties: {
              type: 'msp',
              is_system_client: true,
              created_by: 'tenant_setup'
            },
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('client_id');
        clientId = clientResult[0].client_id;
        log.info('Client created', { clientId, clientName, tenantId });
        
        // Create default location for the MSP client with email from the tenant setup
        // Insert minimal required fields to satisfy NOT NULL constraints
        await trx('client_locations')
          .insert({
            location_id: knex.raw('gen_random_uuid()'),
            client_id: clientId,
            tenant: tenantId,
            location_name: 'Main Office',
            email: input.email.toLowerCase(), // default contact email (lowercased)
            phone: '',
            address_line1: 'N/A', // required, placeholder per migration convention
            city: 'N/A', // required by schema
            country_code: 'XX', // required by schema (ISO-3166 alpha-2)
            country_name: 'Unknown', // required by schema
            is_default: true,
            is_active: true,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });
        log.info('Default location created', { clientId, email: input.email });
        
        // Note: Not updating tenant with client_id as column doesn't exist in schema
      }

      return { tenantId, clientId };
    });

    return {
      tenantId: result.tenantId,
      clientId: result.clientId,
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

      // Create tenant-client association if we have a client/company id
      if (input.clientId) {
        try {
          await trx('tenant_companies')
            .insert({
              tenant: input.tenantId,
              client_id: input.clientId,
              is_default: true
            });
          setupSteps.push('tenant_client_association');
        } catch (error) {
          // If it already exists, that's fine
          log.info('Tenant-client association already exists, skipping', { tenantId: input.tenantId, clientId: input.clientId });
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
      
      // Delete tenant_companies associations (references tenant and clients)
      await trx('tenant_companies').where({ tenant: tenantId }).delete();
      
      // Delete tenant_email_settings (references tenant indirectly)
      await trx('tenant_email_settings').where({ tenant: tenantId }).delete();
      
      // Delete tenant_settings (references tenant)
      await trx('tenant_settings').where({ tenant: tenantId }).delete();
      
      // Delete clients (references tenant)
      await trx('clients').where({ tenant: tenantId }).delete();
      
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
