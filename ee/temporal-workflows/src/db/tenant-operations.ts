import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import type { Knex } from 'knex';
import type {
  CreateTenantActivityInput,
  CreateTenantActivityResult,
  SetupTenantDataActivityInput,
  SetupTenantDataActivityResult
} from '../types/workflow-types.js';
import { updateSubscriptionMetadata } from '../services/stripe-service.js';
import { getSecret } from '@alga-psa/core/secrets';

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

      // Insert Stripe customer and subscription if provided
      if (input.stripeCustomerId) {
        const MASTER_TENANT_ID = await getSecret('master_billing_tenant_id', 'MASTER_BILLING_TENANT_ID');

        if (!MASTER_TENANT_ID) {
          throw new Error('MASTER_BILLING_TENANT_ID not configured');
        }

        log.info('Creating Stripe customer record', {
          tenantId,
          stripeCustomerId: input.stripeCustomerId
        });

        const [stripeCustomer] = await trx('stripe_customers')
          .insert({
            tenant: tenantId,
            stripe_customer_id: trx.raw('gen_random_uuid()'), // Internal UUID
            stripe_customer_external_id: input.stripeCustomerId, // Stripe's ID (cus_...)
            billing_tenant: MASTER_TENANT_ID,
            email: input.email,
            name: input.clientName || input.companyName || input.tenantName,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now(),
          })
          .returning('*');

        log.info('Stripe customer created successfully', {
          stripeCustomerId: input.stripeCustomerId,
          internalId: stripeCustomer.stripe_customer_id
        });

        // Insert Stripe subscription if provided
        if (input.stripeSubscriptionId && input.stripePriceId) {
          log.info('Looking up Stripe price', {
            stripePriceId: input.stripePriceId
          });

          // Check if price exists in our database
          const price = await trx('stripe_prices')
            .where({
              stripe_price_external_id: input.stripePriceId,
              tenant: MASTER_TENANT_ID
            })
            .first();

          if (!price) {
            log.warn(
              `Price ${input.stripePriceId} not found in database. ` +
              `Subscription will not be created. Ensure prices are pre-populated.`
            );
          } else {
            log.info('Creating Stripe subscription record', {
              tenantId,
              stripeSubscriptionId: input.stripeSubscriptionId,
              quantity: input.licenseCount || 1
            });

            await trx('stripe_subscriptions')
              .insert({
                tenant: tenantId,
                stripe_subscription_id: trx.raw('gen_random_uuid()'), // Internal UUID
                stripe_subscription_external_id: input.stripeSubscriptionId, // Stripe's ID (sub_...)
                stripe_subscription_item_id: input.stripeSubscriptionItemId, // For quantity updates
                stripe_customer_id: stripeCustomer.stripe_customer_id, // FK to our stripe_customers
                stripe_price_id: price.stripe_price_id, // FK to our stripe_prices
                status: 'active',
                quantity: input.licenseCount || 1,
                current_period_start: knex.fn.now(),
                current_period_end: trx.raw(`NOW() + INTERVAL '1 month'`),
                created_at: knex.fn.now(),
                updated_at: knex.fn.now(),
              })
              .returning('*');

            log.info('Stripe subscription created successfully', {
              stripeSubscriptionId: input.stripeSubscriptionId
            });
          }
        }
      } else {
        log.info('No Stripe customer ID provided, skipping Stripe integration', {
          tenantId
        });
      }

      // Create client if name is provided (now with tenant ID)
      let clientId: string | undefined;

      const clientName = input.clientName ?? input.companyName;

      if (clientName) {
        const clientResult = await trx('clients')
          .insert({
            client_name: clientName,
            tenant: tenantId,
            client_type: 'company',
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

    // Update Stripe subscription metadata with tenant ID (outside transaction)
    // This links the Stripe subscription to our tenant
    if (input.stripeSubscriptionId && result.tenantId) {
      try {
        log.info('Updating Stripe subscription metadata with tenant ID', {
          stripeSubscriptionId: input.stripeSubscriptionId,
          tenantId: result.tenantId
        });

        await updateSubscriptionMetadata(input.stripeSubscriptionId, {
          tenant_id: result.tenantId,
          tenant_name: input.clientName || input.companyName || input.tenantName,
        });

        log.info('Stripe subscription metadata updated successfully', {
          stripeSubscriptionId: input.stripeSubscriptionId,
          tenantId: result.tenantId
        });
      } catch (metadataError) {
        // Log the error but don't fail the tenant creation
        // The subscription exists in our DB, metadata update is optional
        log.error('Failed to update Stripe subscription metadata (non-fatal)', {
          error: metadataError instanceof Error ? metadataError.message : 'Unknown error',
          stripeSubscriptionId: input.stripeSubscriptionId,
          tenantId: result.tenantId
        });
      }
    }

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
 * Set up initial tenant data (contract lines, default settings, etc.)
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
            tenant: input.tenantId,
            email_provider: 'resend',
            fallback_enabled: true,
            tracking_enabled: false
          });
        setupSteps.push('email_settings');
        log.info('Tenant email settings created successfully', { tenantId: input.tenantId });
      } catch (error) {
        // If it already exists, that's fine - log but don't block tenant creation
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.warn('Failed to create tenant email settings (non-blocking)', {
          tenantId: input.tenantId,
          error: errorMessage
        });
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
        log.info('Tenant settings created successfully', { tenantId: input.tenantId });
      } catch (error) {
        // If it already exists, that's fine - log but don't block tenant creation
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.warn('Failed to create tenant settings (non-blocking)', {
          tenantId: input.tenantId,
          error: errorMessage
        });
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
          log.info('Tenant-client association created successfully', { tenantId: input.tenantId, clientId: input.clientId });
        } catch (error) {
          // If it already exists, that's fine - log but don't block tenant creation
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          log.warn('Failed to create tenant-client association (non-blocking)', {
            tenantId: input.tenantId,
            clientId: input.clientId,
            error: errorMessage
          });
        }
      }

      // Initialize tenant notification settings from global defaults
      try {
        // Seed email notification category settings
        const categories = await trx('notification_categories')
          .select('id', 'is_enabled', 'is_default_enabled');

        if (categories.length > 0) {
          await trx('tenant_notification_category_settings')
            .insert(categories.map(category => ({
              tenant: input.tenantId,
              tenant_notification_category_setting_id: trx.raw('gen_random_uuid()'),
              category_id: category.id,
              is_enabled: category.is_enabled,
              is_default_enabled: category.is_default_enabled,
              created_at: knex.fn.now(),
              updated_at: knex.fn.now()
            })));
        }

        // Seed email notification subtype settings
        const subtypes = await trx('notification_subtypes')
          .select('id', 'is_enabled', 'is_default_enabled');

        if (subtypes.length > 0) {
          await trx('tenant_notification_subtype_settings')
            .insert(subtypes.map(subtype => ({
              tenant: input.tenantId,
              tenant_notification_subtype_setting_id: trx.raw('gen_random_uuid()'),
              subtype_id: subtype.id,
              is_enabled: subtype.is_enabled,
              is_default_enabled: subtype.is_default_enabled,
              created_at: knex.fn.now(),
              updated_at: knex.fn.now()
            })));
        }

        // Seed internal notification category settings
        const internalCategories = await trx('internal_notification_categories')
          .select('internal_notification_category_id', 'is_enabled', 'is_default_enabled');

        if (internalCategories.length > 0) {
          await trx('tenant_internal_notification_category_settings')
            .insert(internalCategories.map(category => ({
              tenant: input.tenantId,
              tenant_internal_notification_category_setting_id: trx.raw('gen_random_uuid()'),
              category_id: category.internal_notification_category_id,
              is_enabled: category.is_enabled,
              is_default_enabled: category.is_default_enabled,
              created_at: knex.fn.now(),
              updated_at: knex.fn.now()
            })));
        }

        // Seed internal notification subtype settings
        const internalSubtypes = await trx('internal_notification_subtypes')
          .select('internal_notification_subtype_id', 'is_enabled', 'is_default_enabled');

        if (internalSubtypes.length > 0) {
          await trx('tenant_internal_notification_subtype_settings')
            .insert(internalSubtypes.map(subtype => ({
              tenant: input.tenantId,
              tenant_internal_notification_subtype_setting_id: trx.raw('gen_random_uuid()'),
              subtype_id: subtype.internal_notification_subtype_id,
              is_enabled: subtype.is_enabled,
              is_default_enabled: subtype.is_default_enabled,
              created_at: knex.fn.now(),
              updated_at: knex.fn.now()
            })));
        }

        setupSteps.push('notification_settings');
        log.info('Tenant notification settings created successfully', { tenantId: input.tenantId });
      } catch (error) {
        // Log but don't block tenant creation - notifications will fall back to global settings
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.warn('Failed to create tenant notification settings (non-blocking)', {
          tenantId: input.tenantId,
          error: errorMessage
        });
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

      // Delete tenant notification settings
      await trx('tenant_notification_category_settings').where({ tenant: tenantId }).delete();
      await trx('tenant_notification_subtype_settings').where({ tenant: tenantId }).delete();
      await trx('tenant_internal_notification_category_settings').where({ tenant: tenantId }).delete();
      await trx('tenant_internal_notification_subtype_settings').where({ tenant: tenantId }).delete();

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
