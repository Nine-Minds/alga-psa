import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { ITmConversionMonthBucket } from '@alga-psa/types';
import type { GeneratedSuggestion, SuggestionGenerator } from './types';

export interface TmBillingFact {
  client_id: string;
  client_name: string;
  currency_code: string;
  monthly_totals: ITmConversionMonthBucket[];
  trailing_12_total_cents: number;
  monthly_avg_cents: number;
}

export interface TmBillingFactsResult {
  facts: TmBillingFact[];
  mixedCurrencyClientIds: string[];
}

interface TmBillingRow {
  client_id: string;
  client_name: string;
  currency_code: string;
  month: string;
  total_cents: string | number | null;
}

export function trailingTwelveMonthKeys(now = new Date()): string[] {
  const keys: string[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

export function quarterKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

export async function getTmBillingFacts(
  knex: Knex,
  tenant: string,
  now = new Date(),
): Promise<TmBillingFact[]> {
  return (await loadTmBillingFacts(knex, tenant, now)).facts;
}

export async function loadTmBillingFacts(
  knex: Knex,
  tenant: string,
  now = new Date(),
): Promise<TmBillingFactsResult> {
  const months = trailingTwelveMonthKeys(now);
  const start = `${months[0]}-01T00:00:00.000Z`;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const db = tenantDb(knex, tenant);
  const linkedTimeItems = db.table('invoice_time_entries')
    .whereNotNull('item_id')
    .distinct('item_id');
  const query = db.table('invoice_charges as ic');
  db.tenantJoin(query, 'invoices as inv', 'ic.invoice_id', 'inv.invoice_id');
  db.tenantJoin(query, 'clients as c', 'inv.client_id', 'c.client_id');
  query.join(linkedTimeItems.as('time_items'), 'time_items.item_id', 'ic.item_id');

  const rows = await query
    .where('inv.invoice_date', '>=', start)
    .andWhere('inv.invoice_date', '<', end)
    .whereRaw('LOWER(inv.status) NOT IN (?, ?, ?)', ['draft', 'cancelled', 'canceled'])
    .groupBy(
      'inv.client_id',
      'c.client_name',
      'inv.currency_code',
      knex.raw("to_char(inv.invoice_date AT TIME ZONE 'UTC', 'YYYY-MM')"),
    )
    .select(
      'inv.client_id',
      'c.client_name',
      'inv.currency_code',
      knex.raw("to_char(inv.invoice_date AT TIME ZONE 'UTC', 'YYYY-MM') as month"),
    )
    .sum({ total_cents: 'ic.net_amount' }) as TmBillingRow[];

  const rowsByClient = new Map<string, TmBillingRow[]>();
  for (const row of rows) {
    const current = rowsByClient.get(row.client_id) ?? [];
    current.push(row);
    rowsByClient.set(row.client_id, current);
  }

  const facts: TmBillingFact[] = [];
  const mixedCurrencyClientIds: string[] = [];
  for (const [clientId, clientRows] of rowsByClient) {
    const currencies = new Set(clientRows.map((row) => row.currency_code));
    if (currencies.size !== 1) {
      mixedCurrencyClientIds.push(clientId);
      continue;
    }
    const totalByMonth = new Map(clientRows.map((row) => [row.month, Number(row.total_cents ?? 0) || 0]));
    const monthlyTotals = months.map((month) => ({
      month,
      total_cents: totalByMonth.get(month) ?? 0,
    }));
    const total = monthlyTotals.reduce((sum, bucket) => sum + bucket.total_cents, 0);
    facts.push({
      client_id: clientId,
      client_name: clientRows[0].client_name,
      currency_code: clientRows[0].currency_code,
      monthly_totals: monthlyTotals,
      trailing_12_total_cents: total,
      monthly_avg_cents: Math.round(total / 12),
    });
  }
  return { facts, mixedCurrencyClientIds };
}

export function buildTmConversionSuggestions(
  facts: TmBillingFact[],
  thresholdCents: number,
  currentQuarter: string,
): GeneratedSuggestion[] {
  return facts
    .filter((fact) => fact.monthly_avg_cents >= thresholdCents)
    .map((fact) => ({
      client_id: fact.client_id,
      title: `${fact.client_name} T&M agreement conversion`,
      evidence: {
        monthly_totals: fact.monthly_totals,
        trailing_12_total_cents: fact.trailing_12_total_cents,
        monthly_avg_cents: fact.monthly_avg_cents,
        client_count: 1,
        client_names: [fact.client_name],
      },
      mrr_cents: fact.monthly_avg_cents,
      nrr_cents: 0,
      currency_code: fact.currency_code,
      dedupe_key: `tm:${fact.client_id}:${currentQuarter}`,
    }));
}

export const tmConversionGenerator: SuggestionGenerator = {
  key: 'tm_conversion',
  run: async ({ knex, tenant, settings }) => buildTmConversionSuggestions(
    await getTmBillingFacts(knex, tenant),
    settings.tm_threshold_cents,
    quarterKey(),
  ),
};
