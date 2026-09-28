import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toTenantLocalDate } from '@alga-psa/event-bus/workflow/dateDomainEvents';
import type { DateTriggerSource } from '../types';
import { buildAssetWarrantyExpiringPayload } from '@alga-psa/workflow-streams';

export const assetWarrantyEndSource: DateTriggerSource = {
  id: 'asset.warranty_end', payloadSchemaRef: 'payload.AssetWarrantyEnd.v1',
  domainEvent: { eventType: 'ASSET_WARRANTY_EXPIRING', windowDays: 30, buildPayload: (occurrence, daysUntil) => buildAssetWarrantyExpiringPayload({ assetId: occurrence.entityId, clientId: occurrence.clientId || undefined, expiresAt: `${occurrence.occursOn}T00:00:00.000Z`, daysUntilExpiry: daysUntil }) },
  async findOccurrences(knex: Knex, tenant: string, fromDate: string, toDate: string) {
    const rows = await tenantDb(knex, tenant).table('assets as a')
      .leftJoin('clients as c', function joinClient() { this.on('c.client_id', '=', 'a.client_id').andOn('c.tenant', '=', 'a.tenant'); })
      .leftJoin('tenant_settings as ts', 'ts.tenant', 'a.tenant')
      .select('a.asset_id', 'a.client_id', 'a.name as asset_name', 'a.warranty_end_date', 'c.client_name', 'ts.settings')
      .whereNotNull('a.warranty_end_date')
      .whereRaw("a.warranty_end_date >= (?::date::timestamp AT TIME ZONE COALESCE(ts.settings->>'timezone', 'UTC')) AND a.warranty_end_date < ((?::date + 1)::timestamp AT TIME ZONE COALESCE(ts.settings->>'timezone', 'UTC'))", [fromDate, toDate])
      .whereNotIn('a.status', ['retired', 'disposed'])
      .orderBy('a.asset_id', 'asc');
    return rows.map((r) => {
      const timezone = typeof r.settings?.timezone === 'string' ? r.settings.timezone : 'UTC';
      const occursOn = toTenantLocalDate(r.warranty_end_date, timezone);
      return { entityId: r.asset_id, clientId: r.client_id ?? '', occursOn, cycleKey: occursOn, payload: { assetId: r.asset_id, assetName: r.asset_name, clientId: r.client_id, clientName: r.client_name, occursOn, warrantyEndDate: occursOn } };
    });
  },
};
