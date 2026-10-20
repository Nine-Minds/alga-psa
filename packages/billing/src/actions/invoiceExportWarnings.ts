'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Accounting readiness intentionally bridges billing with integration-owned connection discovery, like the export adapters. */

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getStoredQboCredentialsMap } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getStoredXeroConnections } from '@alga-psa/integrations/lib/xero/xeroClientService';
import { AccountingMappingResolver } from '../services/accountingMappingResolver';

export const getInvoiceAdjustmentExportWarnings = withAuth(async (user, { tenant }, invoiceId: string,
  manualLines: Array<{ service_id?: string | null; description?: string; is_discount?: boolean; rate?: number }>,
): Promise<Array<{ code: 'service' | 'discount'; description: string; adapter: string }>> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'invoice', 'read', knex)) throw new Error('Permission denied: invoice read required');
  const db = tenantDb(knex, tenant);
  if (!await db.table('invoices').where({ invoice_id: invoiceId }).first('invoice_id')) throw new Error('Invoice not found');
  const [qbo, xero, fileMappings, generated] = await Promise.all([
    getStoredQboCredentialsMap(tenant), getStoredXeroConnections(tenant),
    db.table('tenant_external_entity_mappings').whereIn('integration_type', ['quickbooks_csv', 'xero_csv', 'quickbooks_desktop'])
      .whereNull('deleted_at').distinct('integration_type'),
    db.table('invoice_charges').where({ invoice_id: invoiceId, is_manual: false }).select('item_id', 'service_id', 'description', 'is_discount'),
  ]);
  const parentIds = generated.filter(row => !row.service_id && !row.is_discount).map(row => row.item_id);
  const details = parentIds.length ? await db.table('invoice_charge_details').whereIn('item_id', parentIds).select('service_id', 'item_id') : [];
  const generatedLines = [
    ...generated.filter(row => row.service_id || row.is_discount || !details.some(detail => detail.item_id === row.item_id)),
    ...details.map(row => ({ service_id: row.service_id, description: generated.find(parent => parent.item_id === row.item_id)?.description, is_discount: false })),
  ];
  const targets = [
    ...Object.keys(qbo).map(realm => ({ adapter: 'quickbooks_online', realm })),
    ...Object.keys(xero).map(realm => ({ adapter: 'xero', realm })),
    ...fileMappings.map(row => ({ adapter: row.integration_type as string, realm: null })),
  ];
  const resolver = new AccountingMappingResolver(knex, undefined, tenant);
  const warnings: Array<{ code: 'service' | 'discount'; description: string; adapter: string }> = [];
  for (const target of targets) {
    for (const line of [...generatedLines, ...manualLines]) {
      const discount = line.is_discount || ('rate' in line && Number(line.rate) < 0);
      const mapping = discount
        ? await resolver.resolveDiscountMapping({ adapterType: target.adapter, targetRealm: target.realm })
        : line.service_id ? await resolver.resolveServiceMapping({ adapterType: target.adapter, targetRealm: target.realm, serviceId: line.service_id }) : null;
      if (!mapping) warnings.push({ code: discount ? 'discount' : 'service', description: line.description ?? '', adapter: target.adapter });
    }
  }
  return warnings;
});
