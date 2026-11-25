import type { Knex } from 'knex';
import { tenantDb, type TenantDb } from '@alga-psa/db';
import type { IOpportunityDetail, IOpportunityEvidence, IOpportunityLadderCitation } from '@alga-psa/types';
import { OpportunityModel } from '../models/opportunityModel';

function optionalIso(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

async function loadActiveEvidence(db: TenantDb, opportunityId: string): Promise<IOpportunityEvidence[]> {
  return db.table('opportunity_evidence')
    .where({ opportunity_id: opportunityId })
    .whereNull('corrected_at')
    .orderBy('recorded_at', 'asc') as Promise<IOpportunityEvidence[]>;
}

/**
 * The sources cited by the opportunity's active declarations, keyed by evidence
 * id and ordered by `position`. Each cited interaction/document is resolved by
 * LEFT JOIN (tenant-constrained on every join), so a deleted or detached target
 * yields `missing` instead of an error. A document only resolves while it is
 * still attached to this opportunity — the viewer opens it from the deal.
 */
async function loadCitationsByEvidence(db: TenantDb, opportunityId: string): Promise<Map<string, IOpportunityLadderCitation[]>> {
  const query = db.table('opportunity_evidence_citations as cc');
  db.tenantJoin(query, 'opportunity_evidence as oe', 'oe.evidence_id', 'cc.evidence_id', { rootTenantColumn: 'cc.tenant' });
  db.tenantJoin(query, 'interactions as ci', 'ci.interaction_id', 'cc.ref_id', {
    type: 'left',
    rootTenantColumn: 'cc.tenant',
    on: (join) => join.andOnVal('cc.ref_type', '=', 'interaction').andOn('ci.opportunity_id', '=', 'oe.opportunity_id'),
  });
  db.tenantJoin(query, 'document_associations as cda', 'cda.document_id', 'cc.ref_id', {
    type: 'left',
    rootTenantColumn: 'cc.tenant',
    on: (join) => join
      .andOnVal('cc.ref_type', '=', 'document')
      .andOnVal('cda.entity_type', '=', 'opportunity')
      .andOn('cda.entity_id', '=', 'oe.opportunity_id'),
  });
  db.tenantJoin(query, 'documents as cd', 'cd.document_id', 'cda.document_id', {
    type: 'left',
    rootTenantColumn: 'cda.tenant',
  });
  const rows = await query
    .where({ 'oe.opportunity_id': opportunityId })
    .whereNull('oe.corrected_at')
    .select(
      'cc.citation_id', 'cc.evidence_id', 'cc.ref_type', 'cc.ref_id',
      'ci.title as interaction_title', 'ci.interaction_id as resolved_interaction_id',
      'cd.document_name as document_name', 'cd.document_id as resolved_document_id',
    )
    .orderBy([{ column: 'cc.evidence_id' }, { column: 'cc.position', order: 'asc' }]) as Array<Record<string, any>>;

  const byEvidence = new Map<string, IOpportunityLadderCitation[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.citation_id)) continue; // several associations must not duplicate a source
    seen.add(row.citation_id);
    const missing = row.ref_type === 'interaction' ? !row.resolved_interaction_id : !row.resolved_document_id;
    const citation: IOpportunityLadderCitation = {
      citation_id: row.citation_id,
      type: row.ref_type,
      id: row.ref_id,
      label: missing ? null : (row.ref_type === 'interaction' ? row.interaction_title : row.document_name) ?? null,
      missing,
    };
    byEvidence.set(row.evidence_id, [...(byEvidence.get(row.evidence_id) ?? []), citation]);
  }
  return byEvidence;
}

export async function getOpportunityDetail(
  conn: Knex | Knex.Transaction,
  tenant: string,
  opportunityId: string,
): Promise<IOpportunityDetail | null> {
  const opportunity = await OpportunityModel.getById(conn, tenant, opportunityId);
  if (!opportunity) return null;

  const db = tenantDb(conn, tenant);
  const [client, contact, contactPhone, owner, evidenceRows, citationsByEvidence, quotes] = await Promise.all([
    db.table('clients').where({ client_id: opportunity.client_id }).select('client_name', 'lifecycle_status').first(),
    opportunity.contact_id
      ? db.table('contacts').where({ contact_name_id: opportunity.contact_id }).select('full_name', 'email').first()
      : null,
    opportunity.contact_id
      ? db.table('contact_phone_numbers')
          .where({ contact_name_id: opportunity.contact_id })
          .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'display_order', order: 'asc' }])
          .select('phone_number')
          .first()
      : null,
    db.table('users').where({ user_id: opportunity.owner_id }).select('first_name', 'last_name').first(),
    loadActiveEvidence(db, opportunityId),
    loadCitationsByEvidence(db, opportunityId),
    db.table('quotes')
      .where({ opportunity_id: opportunityId })
      .select('quote_id', 'quote_number', 'status', 'total_amount', 'currency_code', 'sent_at', 'accepted_at'),
  ]);

  const evidence = evidenceRows.map((item) => ({
    ...item,
    recorded_at: optionalIso(item.recorded_at) as string,
    corrected_at: optionalIso(item.corrected_at),
  }));
  // The live user declaration behind a rung; the newest if legacy data holds several.
  const declarationFor = (checkpoint: string) => {
    const live = evidence.filter((item) => item.checkpoint === checkpoint && item.source === 'user_declared').pop();
    return live
      ? {
          evidence_id: live.evidence_id,
          note: live.detail?.trim() ? live.detail : null,
          recorded_at: live.recorded_at,
          citations: citationsByEvidence.get(live.evidence_id) ?? [],
        }
      : null;
  };
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
    contact_phone: contactPhone?.phone_number ?? null,
    contact_email: contact?.email ?? null,
    owner_name: [owner?.first_name, owner?.last_name].filter(Boolean).join(' '),
    ladder: [
      { checkpoint: 'identified', state: 'reached', evidence: null, declaration: null },
      ...checkpoints.map((checkpoint, index) => ({
        checkpoint,
        state: evidence.some((item) => item.checkpoint === checkpoint)
          ? 'reached' as const
          : index < furthestReached
            ? 'skipped' as const
            : 'pending' as const,
        evidence: evidence.find((item) => item.checkpoint === checkpoint) ?? null,
        declaration: declarationFor(checkpoint),
      })),
    ],
    linked_quotes: quotes.map((quote: any) => ({
      ...quote,
      total_amount: Number(quote.total_amount),
      sent_at: optionalIso(quote.sent_at),
      accepted_at: optionalIso(quote.accepted_at),
    })),
    why: {
      segments: [
        {
          message: {
            key: 'opportunities.detail.whyNumber',
            params: { number: opportunity.opportunity_number },
          },
          emphasis: true,
        },
        {
          message: { key: `opportunities.stage.${opportunity.stage}` },
          emphasis: true,
        },
        { message: { key: 'opportunities.detail.whyPeriod' } },
      ],
    },
  };
}
