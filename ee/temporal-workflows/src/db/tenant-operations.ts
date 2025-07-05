import { Context } from '@temporalio/activity';
import { getMainDatabase, getAdminDatabase, executeQuery, executeTransaction } from './connection.js';
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
    const adminDb = getAdminDatabase();
    
    const result = await executeTransaction(adminDb, async (client) => {
      // Create tenant first (include admin email since it's required)
      const tenantResult = await client.query(
        `INSERT INTO tenants (company_name, email, created_at, updated_at) 
         VALUES ($1, $2, NOW(), NOW()) 
         RETURNING tenant`,
        [input.tenantName, input.email]
      );
      
      const tenantId = tenantResult.rows[0].tenant;
      log.info('Tenant created successfully', { tenantId });

      // Create company if companyName is provided (now with tenant ID)
      let companyId: string | undefined;
      
      if (input.companyName) {
        const companyResult = await client.query(
          `INSERT INTO companies (company_name, tenant, created_at, updated_at) 
           VALUES ($1, $2, NOW(), NOW()) 
           RETURNING company_id`,
          [input.companyName, tenantId]
        );
        companyId = companyResult.rows[0].company_id;
        log.info('Company created', { companyId, companyName: input.companyName, tenantId });
        
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
    const adminDb = getAdminDatabase();
    const setupSteps: string[] = [];

    await executeTransaction(adminDb, async (client) => {
      // Set up tenant email settings with defaults
      await client.query(
        `INSERT INTO tenant_email_settings (tenant_id, email_provider, fallback_enabled, tracking_enabled)
         VALUES ($1, 'resend', true, false)
         ON CONFLICT (tenant_id) DO UPDATE SET
         email_provider = EXCLUDED.email_provider, updated_at = CURRENT_TIMESTAMP`,
        [input.tenantId]
      );
      setupSteps.push('email_settings');

      // Create tenant-company association if we have a company
      if (input.companyId) {
        await client.query(
          `INSERT INTO tenant_companies (tenant, company_id, is_default)
           VALUES ($1, $2, true)
           ON CONFLICT (tenant, company_id) DO UPDATE SET
           is_default = EXCLUDED.is_default, updated_at = CURRENT_TIMESTAMP`,
          [input.tenantId, input.companyId]
        );
        setupSteps.push('tenant_company_association');
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
    const adminDb = getAdminDatabase();

    await executeTransaction(adminDb, async (client) => {
      // Delete related companies first (they reference the tenant)
      await client.query('DELETE FROM companies WHERE tenant = $1', [tenantId]);
      
      // Delete other tenant-related data if exists
      await client.query('DELETE FROM users WHERE tenant = $1', [tenantId]);
      
      // Delete the tenant last
      await client.query('DELETE FROM tenants WHERE tenant = $1', [tenantId]);
    });

    log.info('Tenant rollback completed', { tenantId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to rollback tenant', { error: errorMessage, tenantId });
    // Don't throw here - rollback failures shouldn't mask the original error
  }
}