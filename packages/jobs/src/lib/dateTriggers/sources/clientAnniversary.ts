import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { nextAnnualOccurrence } from '../annual';
import type { DateOccurrence, DateTriggerSource } from '../types';
import { buildClientAnniversaryUpcomingPayload } from '@alga-psa/workflow-streams';

export const clientAnniversarySource: DateTriggerSource = {
  id: 'client.anniversary',
  payloadSchemaRef: 'payload.ClientAnniversary.v1',
  domainEvent: { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', windowDays: 30, buildPayload: (occurrence, daysUntil) => buildClientAnniversaryUpcomingPayload({ clientId: occurrence.clientId, clientName: String(occurrence.payload.clientName), anniversaryDate: occurrence.occursOn, yearsAsClient: Number(occurrence.payload.yearsAsClient), daysUntilAnniversary: daysUntil }) },
  async findOccurrences(knex: Knex, tenant: string, fromDate: string, toDate: string): Promise<DateOccurrence[]> {
    const rows = await tenantDb(knex, tenant).table('clients as c')
      .leftJoin('tenant_settings as ts', 'ts.tenant', 'c.tenant')
      .select('c.client_id', 'c.client_name', 'c.client_since')
      .select(knex.raw("COALESCE(c.client_since, (c.created_at AT TIME ZONE COALESCE(ts.settings->>'timezone', 'UTC'))::date)::text as anniversary_anchor"))
      .where('c.is_inactive', false);
    return rows.flatMap((row) => {
      const anchor = String(row.anniversary_anchor);
      return nextAnnualOccurrence(anchor, fromDate, toDate).map(({ occursOn, yearsAsClient }) => ({
        entityId: row.client_id, clientId: row.client_id, occursOn, cycleKey: occursOn,
        payload: { clientId: row.client_id, clientName: row.client_name, occursOn, anniversaryDate: occursOn, yearsAsClient, anniversarySource: row.client_since ? 'client_since' : 'created_at' },
      }));
    });
  },
};
