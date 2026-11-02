import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export const LEGACY_STRIPE_SECRET_NAME = 'stripe_payment_secret_key';

export function stripeTenantSecretName(configuration: Record<string, unknown> | undefined): string {
  const configured = configuration?.stripe_secret_key_name;
  return typeof configured === 'string' && configured.length > 0 ? configured : LEGACY_STRIPE_SECRET_NAME;
}

/** Atomically merge only named fields into the current tenant Stripe JSON config. */
export async function mergeStripeConfiguration(
  knex: Knex | Knex.Transaction,
  tenant: string,
  configId: string,
  fields: Record<string, unknown>,
): Promise<number> {
  return tenantDb(knex, tenant).table('payment_provider_configs')
    .where({ tenant, config_id: configId, provider_type: 'stripe' })
    .update({
      configuration: knex.raw("COALESCE(configuration, '{}'::jsonb) || ?::jsonb", [JSON.stringify(fields)]),
      updated_at: knex.fn.now(),
    });
}
