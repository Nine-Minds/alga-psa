import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { ISellerOpportunityRollup, OpportunityPeriod } from '@alga-psa/types';

function endExclusive(end: string): string {
  const date = new Date(`${end}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
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
      .select('owner_id', 'mrr_cents', 'nrr_cents'),
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
        'mrr_cents',
        'nrr_cents',
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
  const attachedOpportunityIds = new Set(wonNewLogos.flatMap((deal) => {
    const wonAt = new Date(deal.won_at);
    const through = new Date(wonAt);
    through.setUTCDate(through.getUTCDate() + 60);
    return contracts.some((contract) => (
      contract.client_id === deal.client_id
      && new Date(contract.start_date) >= wonAt
      && new Date(contract.start_date) <= through
    )) ? [deal.opportunity_id] : [];
  }));

  return ownerIds.map((ownerId) => {
    const ownerOpen = open.filter((row) => String(row.owner_id) === ownerId);
    const won = closed.filter((row) => String(row.owner_id) === ownerId && row.status === 'won');
    const lost = closed.filter((row) => String(row.owner_id) === ownerId && row.status === 'lost');
    const ownerNewLogos = won.filter((row) => row.opportunity_type === 'new_logo');
    const ownerAttached = ownerNewLogos.filter((row) => attachedOpportunityIds.has(row.opportunity_id));
    const sum = (rows: any[], field: 'mrr_cents' | 'nrr_cents') => rows.reduce(
      (total, row) => total + Number(row[field] ?? 0),
      0,
    );
    return {
      owner_id: ownerId,
      owner_name: names.get(ownerId) ?? ownerId,
      office_id: null,
      office_name: null,
      open_mrr_cents: sum(ownerOpen, 'mrr_cents'),
      open_nrr_cents: sum(ownerOpen, 'nrr_cents'),
      won_count: won.length,
      won_mrr_cents: sum(won, 'mrr_cents'),
      won_nrr_cents: sum(won, 'nrr_cents'),
      lost_count: lost.length,
      lost_mrr_cents: sum(lost, 'mrr_cents'),
      lost_nrr_cents: sum(lost, 'nrr_cents'),
      attach_rate: ownerNewLogos.length ? ownerAttached.length / ownerNewLogos.length : 0,
    };
  });
}
