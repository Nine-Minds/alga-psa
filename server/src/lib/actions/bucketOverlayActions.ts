'use server';

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { withTransaction } from '@alga-psa/shared/db';

// Bucket overlay input type - matches the structure used in wizard
export type BucketOverlayInput = {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: 'weekly' | 'monthly';
};

/**
 * Upsert a bucket overlay configuration for a service on a contract line.
 * This creates a separate Bucket configuration that co-exists with the main
 * service configuration (Hourly/Usage).
 *
 * @param contractLineId - The contract line ID
 * @param serviceId - The service ID
 * @param overlay - The bucket overlay configuration
 * @param quantity - Optional quantity for the service
 * @param customRate - Optional custom rate for the service
 */
export async function upsertBucketOverlay(
  contractLineId: string,
  serviceId: string,
  overlay: BucketOverlayInput,
  quantity?: number | null,
  customRate?: number | null
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const tenant = user.tenant;

  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx) => {
    await upsertBucketOverlayInTransaction(
      trx,
      tenant,
      contractLineId,
      serviceId,
      overlay,
      quantity,
      customRate
    );
  });
}

/**
 * Internal function to upsert bucket overlay within a transaction.
 * Can be called from other transaction-aware code.
 */
export async function upsertBucketOverlayInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
  overlay: BucketOverlayInput,
  quantity?: number | null,
  customRate?: number | null
): Promise<void> {
  if (overlay.total_minutes == null || overlay.overage_rate == null) {
    return;
  }

  const normalizedTotal = Math.max(0, Math.round(overlay.total_minutes));
  const normalizedOverage = Math.max(0, Math.round(overlay.overage_rate));
  const billingPeriod = overlay.billing_period ?? 'monthly';

  const existing = await trx('contract_line_service_configuration')
    .where({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket',
    })
    .first('config_id');

  const configId = existing?.config_id ?? uuidv4();

  // Update or insert the service record
  await trx('contract_line_services')
    .insert({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity: quantity ?? null,
      custom_rate: customRate ?? null,
    })
    .onConflict(['tenant', 'contract_line_id', 'service_id'])
    .merge({
      quantity: quantity ?? null,
      custom_rate: customRate ?? null,
    });

  // Upsert the bucket configuration record
  await trx('contract_line_service_configuration')
    .insert({
      tenant,
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket',
      custom_rate: null,
      quantity: null,
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket',
    });

  // Upsert the bucket-specific config
  await trx('contract_line_service_bucket_config')
    .insert({
      tenant,
      config_id: configId,
      billing_period: billingPeriod,
      total_minutes: normalizedTotal,
      overage_rate: normalizedOverage,
      allow_rollover: overlay.allow_rollover ?? false,
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      billing_period: billingPeriod,
      total_minutes: normalizedTotal,
      overage_rate: normalizedOverage,
      allow_rollover: overlay.allow_rollover ?? false,
    });
}

/**
 * Delete a bucket overlay configuration for a service on a contract line.
 * This removes the separate Bucket configuration while keeping the main
 * service configuration (Hourly/Usage) intact.
 *
 * @param contractLineId - The contract line ID
 * @param serviceId - The service ID
 */
export async function deleteBucketOverlay(
  contractLineId: string,
  serviceId: string
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const tenant = user.tenant;

  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx) => {
    await deleteBucketOverlayInTransaction(trx, tenant, contractLineId, serviceId);
  });
}

/**
 * Internal function to delete bucket overlay within a transaction.
 */
export async function deleteBucketOverlayInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string
): Promise<void> {
  // Find the bucket configuration
  const bucketConfig = await trx('contract_line_service_configuration')
    .where({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket',
    })
    .first('config_id');

  if (!bucketConfig) {
    return; // No bucket config to delete
  }

  // Delete bucket-specific config
  await trx('contract_line_service_bucket_config')
    .where({
      tenant,
      config_id: bucketConfig.config_id,
    })
    .delete();

  // Delete configuration record
  await trx('contract_line_service_configuration')
    .where({
      tenant,
      config_id: bucketConfig.config_id,
    })
    .delete();
}

/**
 * Get bucket overlay configuration for a service on a contract line.
 * Returns null if no bucket overlay exists.
 *
 * @param contractLineId - The contract line ID
 * @param serviceId - The service ID
 * @returns The bucket overlay configuration or null
 */
export async function getBucketOverlay(
  contractLineId: string,
  serviceId: string
): Promise<BucketOverlayInput | null> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const tenant = user.tenant;

  const { knex } = await createTenantKnex();

  const result = await knex('contract_line_service_configuration')
    .join(
      'contract_line_service_bucket_config',
      'contract_line_service_configuration.config_id',
      'contract_line_service_bucket_config.config_id'
    )
    .where({
      'contract_line_service_configuration.tenant': tenant,
      'contract_line_service_configuration.contract_line_id': contractLineId,
      'contract_line_service_configuration.service_id': serviceId,
      'contract_line_service_configuration.configuration_type': 'Bucket',
    })
    .first(
      'contract_line_service_bucket_config.total_minutes',
      'contract_line_service_bucket_config.overage_rate',
      'contract_line_service_bucket_config.allow_rollover',
      'contract_line_service_bucket_config.billing_period'
    );

  if (!result) {
    return null;
  }

  return {
    total_minutes: result.total_minutes,
    overage_rate: result.overage_rate,
    allow_rollover: result.allow_rollover ?? false,
    billing_period: result.billing_period as 'weekly' | 'monthly',
  };
}
