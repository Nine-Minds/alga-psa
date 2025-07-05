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
      // Set up tenant settings using the actual Alga schema
      const defaultSettings = {
        onboarding_completed: false,
        onboarding_skipped: false,
        settings: {
          email_notifications: true,
          auto_backup: true,
          max_users: 100,
          billing_plan: input.billingPlan || 'basic'
        }
      };

      await client.query(
        `INSERT INTO tenant_settings (tenant, onboarding_completed, onboarding_skipped, settings, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (tenant) DO UPDATE SET
         settings = EXCLUDED.settings, updated_at = NOW()`,
        [input.tenantId, defaultSettings.onboarding_completed, defaultSettings.onboarding_skipped, JSON.stringify(defaultSettings.settings)]
      );
      setupSteps.push('tenant_settings');

      // Set up tenant email settings with defaults
      await client.query(
        `INSERT INTO tenant_email_settings (tenant_id, created_at, updated_at)
         VALUES ($1, NOW(), NOW())
         ON CONFLICT (tenant_id) DO NOTHING`,
        [input.tenantId]
      );
      setupSteps.push('email_settings');

      // Create tenant-company association if we have a company
      if (input.companyId) {
        await client.query(
          `INSERT INTO tenant_companies (tenant, company_id, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (tenant, company_id) DO NOTHING`,
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
      // Get company_id before deleting tenant
      const tenantResult = await client.query(
        'SELECT company_id FROM tenants WHERE tenant_id = $1',
        [tenantId]
      );

      // Delete tenant data in reverse order
      await client.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM tenant_billing WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM workspaces WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM tenants WHERE tenant_id = $1', [tenantId]);

      // Delete company if it was created with the tenant and has no other tenants
      if (tenantResult.rows.length > 0 && tenantResult.rows[0].company_id) {
        const companyId = tenantResult.rows[0].company_id;
        const remainingTenants = await client.query(
          'SELECT COUNT(*) as count FROM tenants WHERE company_id = $1',
          [companyId]
        );

        if (remainingTenants.rows[0].count === '0') {
          await client.query('DELETE FROM companies WHERE company_id = $1', [companyId]);
          log.info('Company deleted during rollback', { companyId });
        }
      }
    });

    log.info('Tenant rollback completed', { tenantId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to rollback tenant', { error: errorMessage, tenantId });
    // Don't throw here - rollback failures shouldn't mask the original error
  }
}