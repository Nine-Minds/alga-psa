import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveProductCode } from '@alga-psa/types';
import { createDefaultTaxSettings } from '@alga-psa/shared/billingClients';
import { ensureClientDefaultBillingProfile } from '@alga-psa/shared/billingClients/billingProfiles';
import { ensureDefaultContractForClientIfBillingConfigured } from '@alga-psa/shared/billingClients/defaultContract';

export interface ProvisionEntraClientResult {
  client: {
    client_id: string;
    client_name: string;
    created_at: unknown;
  };
  created: boolean;
}

/**
 * Resolve an approved create-new mapping inside one transaction. Locking the
 * active mapping makes concurrent/retried callers converge on the same client.
 */
export async function provisionEntraClientForMapping(
  knex: Knex | Knex.Transaction,
  params: { tenantId: string; managedTenantId: string }
): Promise<ProvisionEntraClientResult> {
  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, params.tenantId);
    const activeMapping = await db.table('entra_client_tenant_mappings')
      .where({
        managed_tenant_id: params.managedTenantId,
        is_active: true,
      })
      .forUpdate()
      .first(['mapping_id', 'client_id', 'mapping_state']);

    if (!activeMapping) {
      throw new Error(`Approved Entra mapping ${params.managedTenantId} no longer exists.`);
    }

    if (activeMapping.mapping_state === 'mapped' && activeMapping.client_id) {
      const existingClient = await db.table('clients')
        .where({ client_id: activeMapping.client_id })
        .first(['client_id', 'client_name', 'created_at']);
      if (!existingClient) {
        throw new Error(`Mapped client ${activeMapping.client_id} no longer exists.`);
      }
      return { client: existingClient, created: false };
    }

    if (activeMapping.mapping_state !== 'create_new') {
      throw new Error(
        `Entra mapping ${params.managedTenantId} is ${activeMapping.mapping_state}, not create_new.`
      );
    }

    const managedTenant = await db.table('entra_managed_tenants')
      .where({ managed_tenant_id: params.managedTenantId })
      .first(['entra_tenant_id', 'display_name', 'primary_domain']);
    if (!managedTenant) {
      throw new Error(`Managed Entra tenant ${params.managedTenantId} no longer exists.`);
    }

    const clientName = String(
      managedTenant.display_name
      || managedTenant.primary_domain
      || managedTenant.entra_tenant_id
      || 'Imported Entra Tenant'
    );
    // Adopt the tenant's configured default currency rather than the column's
    // own 'USD' default, exactly as createClient does.
    const billingSettings = await db.table('default_billing_settings')
      .select('default_currency_code')
      .first();

    const now = new Date().toISOString();
    const [client] = await db.table('clients')
      .insert({
        tenant: params.tenantId,
        client_name: clientName,
        url: managedTenant.primary_domain || null,
        properties: managedTenant.primary_domain
          ? { website: managedTenant.primary_domain }
          : {},
        entra_tenant_id: managedTenant.entra_tenant_id,
        entra_primary_domain: managedTenant.primary_domain || null,
        default_currency_code: billingSettings?.default_currency_code || 'USD',
        created_at: now,
        updated_at: now,
      })
      .returning(['client_id', 'client_name', 'created_at']);

    if (!client?.client_id) {
      throw new Error(`Failed to provision a client for ${clientName}.`);
    }

    // Every client must have exactly one default billing profile — it is the
    // terminal step of charge attribution.
    await ensureClientDefaultBillingProfile(trx, params.tenantId, String(client.client_id), {
      clientName,
    });

    await ensureDefaultContractForClientIfBillingConfigured(trx, {
      tenant: params.tenantId,
      clientId: String(client.client_id),
    });

    // AlgaDesk has no billing tax setup and keeps its existing exemption.
    const tenantRow = await db.table('tenants').first('product_code');
    if (resolveProductCode(tenantRow?.product_code).productCode !== 'algadesk') {
      await createDefaultTaxSettings(trx, params.tenantId, String(client.client_id));
    }

    await db.table('entra_client_tenant_mappings')
      .where({ mapping_id: activeMapping.mapping_id })
      .update({
        client_id: client.client_id,
        mapping_state: 'mapped',
        updated_at: trx.fn.now(),
      });

    return { client, created: true };
  });
}
