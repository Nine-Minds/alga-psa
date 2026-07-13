import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunityDetail, IOpportunityEvidence } from '@alga-psa/types';
import { OpportunityModel } from '../models/opportunityModel';

function optionalIso(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function getOpportunityDetail(
  conn: Knex | Knex.Transaction,
  tenant: string,
  opportunityId: string,
): Promise<IOpportunityDetail | null> {
  const opportunity = await OpportunityModel.getById(conn, tenant, opportunityId);
  if (!opportunity) return null;

  const db = tenantDb(conn, tenant);
  const [client, contact, owner, evidenceRows, quotes] = await Promise.all([
    db.table('clients').where({ client_id: opportunity.client_id }).select('client_name', 'lifecycle_status').first(),
    opportunity.contact_id
      ? db.table('contacts').where({ contact_name_id: opportunity.contact_id }).select('full_name').first()
      : null,
    db.table('users').where({ user_id: opportunity.owner_id }).select('first_name', 'last_name').first(),
    db.table('opportunity_evidence')
      .where({ opportunity_id: opportunityId })
      .whereNull('corrected_at')
      .orderBy('recorded_at', 'asc') as unknown as Promise<IOpportunityEvidence[]>,
    db.table('quotes')
      .where({ opportunity_id: opportunityId })
      .select('quote_id', 'quote_number', 'status', 'total_amount', 'currency_code', 'sent_at', 'accepted_at'),
  ]);

  const evidence = evidenceRows.map((item) => ({
    ...item,
    recorded_at: optionalIso(item.recorded_at) as string,
    corrected_at: optionalIso(item.corrected_at),
  }));
  const checkpoints = ['qualified', 'assessment', 'proposed', 'verbal', 'won'] as const;
  const furthestReached = checkpoints.reduce<number>(
    (max, checkpoint, index) => evidence.some((item) => item.checkpoint === checkpoint) ? index : max,
    -1,
  );

  return {
    ...opportunity,
    client_name: client?.client_name ?? '',
    client_lifecycle_status: client?.lifecycle_status ?? 'active',
    contact_name: contact?.full_name ?? null,
    owner_name: [owner?.first_name, owner?.last_name].filter(Boolean).join(' '),
    ladder: [
      { checkpoint: 'identified', state: 'reached', evidence: null },
      ...checkpoints.map((checkpoint, index) => ({
        checkpoint,
        state: evidence.some((item) => item.checkpoint === checkpoint)
          ? 'reached' as const
          : index < furthestReached
            ? 'skipped' as const
            : 'pending' as const,
        evidence: evidence.find((item) => item.checkpoint === checkpoint) ?? null,
      })),
    ],
    linked_quotes: quotes.map((quote: any) => ({
      ...quote,
      total_amount: Number(quote.total_amount),
      sent_at: optionalIso(quote.sent_at),
      accepted_at: optionalIso(quote.accepted_at),
    })),
    why: {
      segments: [{ text: `${opportunity.opportunity_number} is at ${opportunity.stage}.`, emphasis: true }],
    },
  };
}
