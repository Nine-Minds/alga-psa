import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getContractMonthlyValuesByAssignment } from '@alga-psa/shared/billingClients/contractMonthlyValue';
import type { GeneratedSuggestion, SuggestionGenerator } from './types';

export interface RenewalCandidateRow {
  client_contract_id: string;
  client_id: string;
  contract_name: string;
  currency_code: string;
  end_date: Date | string | null;
  decision_due_date: Date | string | null;
  renewal_cycle_key: string | null;
}

export type MonthlyValues = Awaited<ReturnType<typeof getContractMonthlyValuesByAssignment>>;

const dateOnly = (value: Date | string | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
};

const utcToday = (now = new Date()): Date => new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  now.getUTCDate(),
));

const daysBetween = (from: Date, toDateOnly: string): number => Math.round(
  (new Date(`${toDateOnly}T00:00:00.000Z`).getTime() - from.getTime()) / 86_400_000,
);

export async function buildRenewalSuggestions(
  knex: Knex,
  tenant: string,
  leadDays: number,
  now = new Date(),
): Promise<GeneratedSuggestion[]> {
  const today = utcToday(now);
  const start = today.toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + leadDays * 86_400_000).toISOString().slice(0, 10);
  const db = tenantDb(knex, tenant);
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as c', 'cc.contract_id', 'c.contract_id');
  const rows = await query
    .where({ 'cc.is_active': true })
    .andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false))
    .andWhere((builder) => {
      builder
        .whereBetween('cc.end_date', [start, horizon])
        .orWhereBetween('cc.decision_due_date', [start, horizon]);
    })
    .select(
      'cc.client_contract_id',
      'cc.client_id',
      'cc.end_date',
      'cc.decision_due_date',
      'cc.renewal_cycle_key',
      'c.contract_name',
      'c.currency_code',
    ) as RenewalCandidateRow[];

  const monthlyValues = await getContractMonthlyValuesByAssignment(
    knex,
    tenant,
    rows.map((row) => row.client_contract_id),
  );

  return mapRenewalCandidates(rows, monthlyValues, today);
}

export function mapRenewalCandidates(
  rows: RenewalCandidateRow[],
  monthlyValues: MonthlyValues,
  today: Date,
): GeneratedSuggestion[] {
  return rows.flatMap((row) => {
    const endDate = dateOnly(row.end_date);
    const decisionDate = dateOnly(row.decision_due_date);
    const targetDate = endDate ?? decisionDate;
    if (!targetDate) return [];
    const monthly = monthlyValues.get(row.client_contract_id);
    const cycleKey = row.renewal_cycle_key ?? endDate ?? decisionDate;
    if (!cycleKey) return [];

    return [{
      client_id: row.client_id,
      title: `${row.contract_name} renewal`,
      evidence: {
        contract_name: row.contract_name,
        end_date: endDate,
        decision_date: decisionDate,
        days_to_renewal: daysBetween(today, targetDate),
        monthly_value_cents: monthly?.monthlyValueCents ?? 0,
        renewal_work_item_id: row.client_contract_id,
        client_contract_id: row.client_contract_id,
      },
      mrr_cents: monthly?.monthlyValueCents ?? 0,
      nrr_cents: 0,
      currency_code: monthly?.currencyCode ?? row.currency_code,
      dedupe_key: `renewal:${row.client_contract_id}:${cycleKey}`,
    }];
  });
}

export const renewalGenerator: SuggestionGenerator = {
  key: 'renewal',
  run: ({ knex, tenant, settings }) => buildRenewalSuggestions(
    knex,
    tenant,
    settings.renewal_lead_days,
  ),
};
