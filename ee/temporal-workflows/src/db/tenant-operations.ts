import { Context } from '@temporalio/activity';
import { getMainDatabase, getAdminDatabase, executeQuery, executeTransaction } from './connection';
import type {
  CreateTenantActivityInput,
  CreateTenantActivityResult,
  SetupTenantDataActivityInput,
  SetupTenantDataActivityResult
} from '../types/workflow-types';

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
      // Set up billing plan if provided
      if (input.billingPlan) {
        await client.query(
          `INSERT INTO tenant_billing (tenant_id, plan_name, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (tenant_id) DO UPDATE SET 
           plan_name = EXCLUDED.plan_name, updated_at = NOW()`,
          [input.tenantId, input.billingPlan]
        );
        setupSteps.push(`billing_plan_${input.billingPlan}`);
      }

      // Set up default tenant settings
      const defaultSettings = [
        { key: 'email_notifications', value: 'true' },
        { key: 'auto_backup', value: 'true' },
        { key: 'max_users', value: '100' },
      ];

      for (const setting of defaultSettings) {
        await client.query(
          `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (tenant_id, setting_key) DO UPDATE SET
           setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
          [input.tenantId, setting.key, setting.value]
        );
        setupSteps.push(`setting_${setting.key}`);
      }

      // Create default workspace/project if applicable
      await client.query(
        `INSERT INTO workspaces (tenant_id, name, description, is_default, created_at, updated_at)
         VALUES ($1, 'Default Workspace', 'Default workspace for tenant', true, NOW(), NOW())`,
        [input.tenantId]
      );
      setupSteps.push('default_workspace');
    });

    log.info('Tenant data setup completed', { 
      tenantId: input.tenantId, 
      setupSteps: setupSteps.length 
    });

    return {
      setupSteps,
      success: true,
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