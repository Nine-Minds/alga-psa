import { createTenantKnex, runWithTenant } from '@/lib/db';
import type { EntraConnectionType, EntraPartnerConnectionRow } from '../../../interfaces/entra.interfaces';
import { mapEntraPartnerConnectionRow } from './entraRowMappers';

export interface EntraConnectionValidationSnapshot {
  message: string;
  code?: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

export async function getActiveEntraPartnerConnection(
  tenant: string
): Promise<EntraPartnerConnectionRow | null> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();
    const row = await knex('entra_partner_connections')
      .where({ tenant, is_active: true })
      .orderBy('updated_at', 'desc')
      .first();

    if (!row) {
      return null;
    }

    return mapEntraPartnerConnectionRow(row as Record<string, unknown>);
  });
}

export async function updateEntraConnectionValidation(
  params: {
    tenant: string;
    connectionType: EntraConnectionType;
    status: string;
    snapshot?: EntraConnectionValidationSnapshot | null;
  }
): Promise<void> {
  await runWithTenant(params.tenant, async () => {
    const { knex } = await createTenantKnex();

    const snapshot = params.snapshot || {};
    await knex('entra_partner_connections')
      .where({
        tenant: params.tenant,
        is_active: true,
        connection_type: params.connectionType,
      })
      .update({
        status: params.status,
        last_validated_at: knex.fn.now(),
        last_validation_error: knex.raw('?::jsonb', [JSON.stringify(snapshot)]),
        updated_at: knex.fn.now(),
      });
  });
}

export async function disconnectActiveEntraConnection(
  params: {
    tenant: string;
    userId?: string | null;
  }
): Promise<void> {
  await runWithTenant(params.tenant, async () => {
    const { knex } = await createTenantKnex();
    await knex('entra_partner_connections')
      .where({
        tenant: params.tenant,
        is_active: true,
      })
      .update({
        is_active: false,
        status: 'disconnected',
        disconnected_at: knex.fn.now(),
        updated_at: knex.fn.now(),
        updated_by: params.userId || null,
      });
  });
}
