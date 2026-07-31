import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunityCommitment, IOpportunityHandoff } from '@alga-psa/types';

export async function loadEnterpriseOpportunityHandoffCommitments(
  knex: Knex | Knex.Transaction,
  tenant: string,
  opportunityId: string,
): Promise<IOpportunityCommitment[]> {
  const enterprise = await import('@enterprise/lib/opportunities/handoffProvider');
  return enterprise.getOpportunityHandoffCommitments(knex, tenant, opportunityId);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function getOpportunityHandoffData(
  knex: Knex | Knex.Transaction,
  tenant: string,
  projectId: string,
): Promise<IOpportunityHandoff | null> {
  const db = tenantDb(knex, tenant);
  const query = db.table('opportunities as o');
  db.tenantJoin(query, 'clients as c', 'o.client_id', 'c.client_id');
  db.tenantJoin(query, 'users as u', 'o.owner_id', 'u.user_id');
  const row = await query
    .where({ 'o.converted_project_id': projectId })
    .select(
      'o.opportunity_id',
      'o.opportunity_number',
      'o.title',
      'o.client_id',
      'c.client_name',
      'o.owner_id',
      knex.raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS owner_name"),
      'o.stage',
      'o.status',
      'o.mrr_cents',
      'o.nrr_cents',
      'o.hardware_cents',
      'o.currency_code',
      'o.won_at',
    )
    .first();
  if (!row) return null;

  const [commitments, interactions] = await Promise.all([
    loadEnterpriseOpportunityHandoffCommitments(knex, tenant, row.opportunity_id),
    db.table('interactions')
      .where({ opportunity_id: row.opportunity_id })
      .whereNotNull('title')
      .select('interaction_id', 'title', 'interaction_date')
      .orderBy('interaction_date', 'asc'),
  ]);

  return {
    opportunity: {
      opportunity_id: String(row.opportunity_id),
      opportunity_number: String(row.opportunity_number),
      title: String(row.title),
      client_id: String(row.client_id),
      client_name: String(row.client_name ?? ''),
      owner_id: String(row.owner_id),
      owner_name: String(row.owner_name ?? ''),
      stage: row.stage,
      status: row.status,
      mrr_cents: Number(row.mrr_cents ?? 0),
      nrr_cents: Number(row.nrr_cents ?? 0),
      hardware_cents: Number(row.hardware_cents ?? 0),
      currency_code: String(row.currency_code),
      won_at: iso(row.won_at),
    },
    commitments,
    timeline: interactions.map((interaction) => ({
      interaction_id: String(interaction.interaction_id),
      title: String(interaction.title),
      interaction_date: iso(interaction.interaction_date)!,
    })),
  };
}
