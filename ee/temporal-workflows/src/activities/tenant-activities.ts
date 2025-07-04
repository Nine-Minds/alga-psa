import { Context } from '@temporalio/activity';
import { v4 as uuidv4 } from 'uuid';
import { getAdminConnection } from '@shared/db';
import { withAdminTransaction } from '@shared/db';
import { Knex } from 'knex';
import type {
  CreateTenantActivityInput,
  CreateTenantActivityResult,
  SetupTenantDataActivityInput,
  SetupTenantDataActivityResult
} from '../types/workflow-types';

const logger = () => Context.current().logger;

/**
 * Creates a new tenant in the database
 * This activity handles the core tenant creation process
 */
export async function createTenant(
  input: CreateTenantActivityInput
): Promise<CreateTenantActivityResult> {
  const log = logger();
  log.info('Creating tenant', { tenantName: input.tenantName });

  const db = await getAdminConnection();
  
  return await withAdminTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Generate tenant ID
      const tenantId = uuidv4();
      
      log.info('Generated tenant ID', { tenantId });

      // Create tenant record
      await trx('tenants').insert({
        tenant: tenantId,
        company_name: input.tenantName,
        created_at: new Date(),
        updated_at: new Date(),
      });

      log.info('Tenant record created', { tenantId });

      let companyId: string | undefined;

      // Create default company if company name is provided
      if (input.companyName) {
        companyId = uuidv4();
        
        await trx('companies').insert({
          company_id: companyId,
          tenant: tenantId,
          company_name: input.companyName,
          is_inactive: false,
          created_at: new Date(),
          updated_at: new Date(),
        });

        log.info('Default company created', { companyId, companyName: input.companyName });

        // Create tenant-company association
        await trx('tenant_companies').insert({
          tenant: tenantId,
          company_id: companyId,
          is_default: true,
          created_at: new Date(),
          updated_at: new Date(),
        });

        log.info('Tenant-company association created', { tenantId, companyId });
      }

      return {
        tenantId,
        companyId,
      };

    } catch (error) {
      log.error('Failed to create tenant', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantName: input.tenantName 
      });
      throw error;
    }
  });
}

/**
 * Sets up initial tenant data after tenant and user creation
 * This includes default settings, billing configuration, etc.
 */
export async function setupTenantData(
  input: SetupTenantDataActivityInput
): Promise<SetupTenantDataActivityResult> {
  const log = logger();
  log.info('Setting up tenant data', { tenantId: input.tenantId });

  const db = await getAdminConnection();
  const setupSteps: string[] = [];

  return await withAdminTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Set up default roles if they don't exist
      const existingRoles = await trx('roles')
        .where({ tenant: input.tenantId })
        .select('role_name');

      const existingRoleNames = existingRoles.map(r => r.role_name.toLowerCase());
      const defaultRoles = [
        { name: 'Admin', description: 'Administrator with full access' },
        { name: 'User', description: 'Standard user with limited access' },
        { name: 'Client', description: 'Client user with restricted access' }
      ];

      for (const role of defaultRoles) {
        if (!existingRoleNames.includes(role.name.toLowerCase())) {
          await trx('roles').insert({
            role_id: uuidv4(),
            tenant: input.tenantId,
            role_name: role.name,
            description: role.description,
            created_at: new Date(),
          });
          setupSteps.push(`Created ${role.name} role`);
        }
      }

      // Set up default statuses
      const existingStatuses = await trx('statuses')
        .where({ tenant: input.tenantId })
        .select('status_name');

      if (existingStatuses.length === 0) {
        const defaultStatuses = [
          { name: 'Open', color: '#3B82F6', is_closed: false },
          { name: 'In Progress', color: '#F59E0B', is_closed: false },
          { name: 'Resolved', color: '#10B981', is_closed: true },
          { name: 'Closed', color: '#6B7280', is_closed: true }
        ];

        for (const status of defaultStatuses) {
          await trx('statuses').insert({
            status_id: uuidv4(),
            tenant: input.tenantId,
            status_name: status.name,
            status_color: status.color,
            is_closed: status.is_closed,
            created_at: new Date(),
          });
        }
        setupSteps.push('Created default statuses');
      }

      // Set up default billing plan if specified
      if (input.billingPlan && input.companyId) {
        // Check if billing plan already exists
        const existingBilling = await trx('company_billing_plans')
          .where({ 
            company_id: input.companyId,
            tenant: input.tenantId 
          })
          .first();

        if (!existingBilling) {
          // Get or create the billing plan
          let billingPlan = await trx('billing_plans')
            .where({ 
              plan_name: input.billingPlan,
              tenant: input.tenantId 
            })
            .first();

          if (!billingPlan) {
            // Create a basic billing plan
            const billingPlanId = uuidv4();
            await trx('billing_plans').insert({
              plan_id: billingPlanId,
              tenant: input.tenantId,
              plan_name: input.billingPlan,
              is_inactive: false,
              created_at: new Date(),
            });

            billingPlan = { plan_id: billingPlanId };
          }

          // Associate billing plan with company
          await trx('company_billing_plans').insert({
            company_id: input.companyId,
            plan_id: billingPlan.plan_id,
            tenant: input.tenantId,
            effective_date: new Date(),
            created_at: new Date(),
          });

          setupSteps.push(`Set up billing plan: ${input.billingPlan}`);
        }
      }

      // Set up default notification settings for the admin user
      if (input.adminUserId) {
        const defaultNotifications = [
          { setting_name: 'email_notifications', setting_value: 'true' },
          { setting_name: 'ticket_assignments', setting_value: 'true' },
          { setting_name: 'workflow_updates', setting_value: 'true' }
        ];

        for (const notification of defaultNotifications) {
          await trx('user_preferences').insert({
            user_id: input.adminUserId,
            setting_name: notification.setting_name,
            setting_value: notification.setting_value,
            created_at: new Date(),
            updated_at: new Date(),
          }).onConflict(['user_id', 'setting_name']).ignore();
        }
        setupSteps.push('Set up default notification preferences');
      }

      log.info('Tenant data setup completed', { 
        tenantId: input.tenantId, 
        setupSteps 
      });

      return {
        success: true,
        setupSteps,
      };

    } catch (error) {
      log.error('Failed to setup tenant data', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId: input.tenantId 
      });
      throw error;
    }
  });
}

/**
 * Rollback tenant creation - removes all tenant-related data
 */
export async function rollbackTenant(tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back tenant creation', { tenantId });

  const db = await getAdminConnection();

  return await withAdminTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Remove in reverse dependency order
      
      // Remove tenant-company associations
      await trx('tenant_companies')
        .where({ tenant: tenantId })
        .del();

      // Remove companies
      await trx('companies')
        .where({ tenant: tenantId })
        .del();

      // Remove user preferences
      await trx('user_preferences')
        .whereIn('user_id', 
          trx('users').select('user_id').where({ tenant: tenantId })
        )
        .del();

      // Remove user roles
      await trx('user_roles')
        .where({ tenant: tenantId })
        .del();

      // Remove users
      await trx('users')
        .where({ tenant: tenantId })
        .del();

      // Remove billing plans and associations
      await trx('company_billing_plans')
        .where({ tenant: tenantId })
        .del();
      
      await trx('billing_plans')
        .where({ tenant: tenantId })
        .del();

      // Remove roles
      await trx('roles')
        .where({ tenant: tenantId })
        .del();

      // Remove statuses
      await trx('statuses')
        .where({ tenant: tenantId })
        .del();

      // Finally, remove the tenant itself
      await trx('tenants')
        .where({ tenant: tenantId })
        .del();

      log.info('Tenant rollback completed', { tenantId });

    } catch (error) {
      log.error('Failed to rollback tenant', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId 
      });
      throw error;
    }
  });
}