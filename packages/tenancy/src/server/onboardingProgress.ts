import type { WizardData } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

/**
 * Applies a shallow onboarding-data patch through a caller-owned connection.
 * Authorization and connection acquisition remain the caller's responsibility.
 */
export async function persistTenantOnboardingProgress(
  connection: Knex | Knex.Transaction,
  tenant: string,
  wizardData: Partial<WizardData>
): Promise<void> {
  // JSON.stringify preserves the existing action contract by omitting undefined
  // object properties before PostgreSQL applies the patch.
  const patchJson = JSON.stringify(wizardData);
  const now = new Date();

  await tenantDb(connection, tenant)
    .table('tenant_settings')
    .insert({
      tenant,
      onboarding_data: patchJson,
      created_at: now,
      updated_at: now,
    })
    .onConflict('tenant')
    .merge({
      onboarding_data: connection.raw(
        `COALESCE(NULLIF(tenant_settings.onboarding_data, 'null'::jsonb), '{}'::jsonb) || ?::jsonb`,
        [patchJson]
      ),
      updated_at: now,
    });
}
