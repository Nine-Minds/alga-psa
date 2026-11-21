import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import type { IPaymentProviderConfig } from '@alga-psa/types';

const primary = 'stripe_payment_secret_key';
const alternate = 'stripe_payment_secret_key_alternate';

// Older rows used the path only to indicate a configured tenant key.
function activeSlot(tenant: string, config?: IPaymentProviderConfig) {
  return config?.credentials_vault_path === `tenant/${tenant}/${alternate}` ? alternate : primary;
}

export function inactiveStripeKey(tenant: string, config?: IPaymentProviderConfig) {
  return activeSlot(tenant, config) === primary ? alternate : primary;
}

export async function readStripeCredentials(knex: Knex, tenant: string) {
  const provider = await getSecretProviderInstance();
  return knex.transaction(async (trx) => {
    // Keep the selected row and its vault value together while a rotation commits.
    const config = await tenantDb(trx, tenant).table<IPaymentProviderConfig>('payment_provider_configs')
      .where({ provider_type: 'stripe' }).forShare().first();
    const secretKey = config && await provider.getTenantSecret(tenant, activeSlot(tenant, config));
    return { config, secretKey };
  });
}

export async function withLockedStripeConfig<T>(
  knex: Knex, tenant: string,
  callback: (trx: Knex.Transaction, config: IPaymentProviderConfig | undefined) => Promise<T>,
) {
  return knex.transaction(async (trx) => {
    // First-time connections have no row to lock.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`stripe-connect:${tenant}`]);
    const config = await tenantDb(trx, tenant).table<IPaymentProviderConfig>('payment_provider_configs')
      .where({ provider_type: 'stripe' }).forUpdate().first();
    return callback(trx, config);
  });
}
