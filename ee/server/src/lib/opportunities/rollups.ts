import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { ISellerOpportunityRollup, OpportunityPeriod } from '@alga-psa/types';

function endExclusive(end: string): string {
  const date = new Date(`${end}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export interface RollupOpenRow {
  owner_id: string;
  currency_code: string;
  mrr_cents: number | string | null;
  nrr_cents: number | string | null;
  hardware_cents: number | string | null;
}

export interface RollupClosedRow extends RollupOpenRow {
  opportunity_id: string;
  status: 'won' | 'lost';
  opportunity_type: string;
}

export function buildSellerRollups(
  open: RollupOpenRow[],
  closed: RollupClosedRow[],
  names: Map<string, string>,
  attachedOpportunityIds: Set<string>,
): ISellerOpportunityRollup[] {
  const ownerIds = [...new Set([...open, ...closed].map((row) => String(row.owner_id)))];

  const sum = (rows: RollupOpenRow[], field: 'mrr_cents' | 'one_time_cents') => rows.reduce(
    // One-time value is NRR + hardware — the same definition the pipeline
    // table and the dashboard snapshot use.
    (total, row) => total + (field === 'mrr_cents'
      ? Number(row.mrr_cents ?? 0)
      : Number(row.nrr_cents ?? 0) + Number(row.hardware_cents ?? 0)),
    0,
  );

  // A seller working two currencies gets one row per currency: summing them
  // would invent money that does not exist in either.
  return ownerIds.flatMap((ownerId) => {
    const ownerOpen = open.filter((row) => String(row.owner_id) === ownerId);
    const ownerClosed = closed.filter((row) => String(row.owner_id) === ownerId);
    // Attach rate is about the seller's deals, not their prices: one cohort
    // across every currency, repeated on each currency row.
    const ownerNewLogos = ownerClosed.filter((row) => row.status === 'won' && row.opportunity_type === 'new_logo');
    const ownerAttached = ownerNewLogos.filter((row) => attachedOpportunityIds.has(row.opportunity_id));
    const attachRate = ownerNewLogos.length ? ownerAttached.length / ownerNewLogos.length : 0;
    const currencies = [...new Set([...ownerOpen, ...ownerClosed].map((row) => String(row.currency_code)))];
    return currencies.map((currency) => {
      const inCurrency = <T extends { currency_code?: unknown }>(rows: T[]) =>
        rows.filter((row) => String(row.currency_code) === currency);
      const currencyOpen = inCurrency(ownerOpen);
      const won = inCurrency(ownerClosed).filter((row) => row.status === 'won');
      const lost = inCurrency(ownerClosed).filter((row) => row.status === 'lost');
      return {
        owner_id: ownerId,
        owner_name: names.get(ownerId) ?? ownerId,
        office_id: null,
        office_name: null,
        currency_code: currency,
        open_mrr_cents: sum(currencyOpen, 'mrr_cents'),
        open_one_time_cents: sum(currencyOpen, 'one_time_cents'),
        won_count: won.length,
        won_mrr_cents: sum(won, 'mrr_cents'),
        won_one_time_cents: sum(won, 'one_time_cents'),
        lost_count: lost.length,
        lost_mrr_cents: sum(lost, 'mrr_cents'),
        lost_one_time_cents: sum(lost, 'one_time_cents'),
        attach_rate: attachRate,
      };
    });
  });
}

export async function getSellerRollupsData(
  knex: Knex,
  tenant: string,
  period: OpportunityPeriod,
): Promise<ISellerOpportunityRollup[]> {
  const db = tenantDb(knex, tenant);
  const [open, closed] = await Promise.all([
    db.table('opportunities')
      .where({ status: 'open' })
      .whereBetween('expected_close_date', [period.start, period.end])
      .select('owner_id', 'currency_code', 'mrr_cents', 'nrr_cents', 'hardware_cents'),
    db.table('opportunities')
      .whereIn('status', ['won', 'lost'])
      .andWhere((builder) => {
        builder
          .where((won) => won
            .where('status', 'won')
            .where('won_at', '>=', `${period.start}T00:00:00.000Z`)
            .where('won_at', '<', endExclusive(period.end)))
          .orWhere((lost) => lost
            .where('status', 'lost')
            .where('lost_at', '>=', `${period.start}T00:00:00.000Z`)
            .where('lost_at', '<', endExclusive(period.end)));
      })
      .select(
        'opportunity_id',
        'owner_id',
        'status',
        'opportunity_type',
        'client_id',
        'won_at',
        'currency_code',
        'mrr_cents',
        'nrr_cents',
        'hardware_cents',
      ),
  ]);
  const ownerIds = [...new Set([...open, ...closed].map((row) => String(row.owner_id)))];
  if (!ownerIds.length) return [];
  const users = await db.table('users')
    .whereIn('user_id', ownerIds)
    .select('user_id', 'first_name', 'last_name');
  const names = new Map(users.map((user) => [
    String(user.user_id),
    `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || String(user.user_id),
  ]));
  const wonNewLogos = closed.filter((row) => row.status === 'won' && row.opportunity_type === 'new_logo' && row.won_at);
  const contracts = wonNewLogos.length
    ? await db.table('client_contracts')
        .where({ is_active: true })
        .whereIn('client_id', [...new Set(wonNewLogos.map((row) => row.client_id))])
        .select('client_id', 'start_date')
    : [];
  const attachedOpportunityIds = new Set<string>(wonNewLogos.flatMap((deal) => {
    const wonAt = new Date(deal.won_at);
    const through = new Date(wonAt);
    through.setUTCDate(through.getUTCDate() + 60);
    return contracts.some((contract) => (
      contract.client_id === deal.client_id
      && new Date(contract.start_date) >= wonAt
      && new Date(contract.start_date) <= through
    )) ? [deal.opportunity_id] : [];
  }));

  return buildSellerRollups(open, closed, names, attachedOpportunityIds);
}
