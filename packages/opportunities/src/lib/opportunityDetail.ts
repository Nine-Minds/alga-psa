import type { Knex } from 'knex';
import { tenantDb, type TenantDb } from '@alga-psa/db';
import type { IOpportunityDetail, IOpportunityEvidence } from '@alga-psa/types';
import { OpportunityModel } from '../models/opportunityModel';

function optionalIso(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

type EvidenceWithCitation = IOpportunityEvidence & { ref_label?: string | null; ref_missing?: boolean };

/**
 * Active evidence with each cited interaction/document resolved by LEFT JOIN
 * (tenant-constrained on every join), so a deleted or detached target yields
 * `ref_missing` instead of an error. A document only resolves while it is
 * still attached to this opportunity — the rung opens it from the deal's own
 * document list.
 */
async function loadActiveEvidenceWithCitations(db: TenantDb, opportunityId: string): Promise<EvidenceWithCitation[]> {
  const query = db.table('opportunity_evidence as oe')
    .where({ 'oe.opportunity_id': opportunityId })
    .whereNull('oe.corrected_at');
  db.tenantJoin(query, 'interactions as ci', 'ci.interaction_id', 'oe.ref_id', {
    type: 'left',
    rootTenantColumn: 'oe.tenant',
    on: (join) => join.andOnVal('oe.ref_type', '=', 'interaction').andOn('ci.opportunity_id', '=', 'oe.opportunity_id'),
  });
  db.tenantJoin(query, 'document_associations as cda', 'cda.document_id', 'oe.ref_id', {
    type: 'left',
    rootTenantColumn: 'oe.tenant',
    on: (join) => join
      .andOnVal('oe.ref_type', '=', 'document')
      .andOnVal('cda.entity_type', '=', 'opportunity')
      .andOn('cda.entity_id', '=', 'oe.opportunity_id'),
  });
  db.tenantJoin(query, 'documents as cd', 'cd.document_id', 'cda.document_id', {
    type: 'left',
    rootTenantColumn: 'cda.tenant',
  });
  const rows = await query
    .select('oe.*', 'ci.title as interaction_title', 'cd.document_name as document_name', 'ci.interaction_id as resolved_interaction_id', 'cd.document_id as resolved_document_id')
    .orderBy('oe.recorded_at', 'asc') as Array<Record<string, any>>;

  const seen = new Set<string>();
  const result: EvidenceWithCitation[] = [];
  for (const row of rows) {
    if (seen.has(row.evidence_id)) continue; // several associations must not duplicate a rung
    seen.add(row.evidence_id);
    const { interaction_title, document_name, resolved_interaction_id, resolved_document_id, ...evidence } = row;
    let ref_label: string | null = null;
    let ref_missing = false;
    if (evidence.ref_type === 'interaction') {
      ref_missing = !resolved_interaction_id;
      ref_label = ref_missing ? null : interaction_title ?? null;
    } else if (evidence.ref_type === 'document') {
      ref_missing = !resolved_document_id;
      ref_label = ref_missing ? null : document_name ?? null;
    }
    result.push({ ...(evidence as IOpportunityEvidence), ref_label, ref_missing });
  }
  return result;
}

export async function getOpportunityDetail(
  conn: Knex | Knex.Transaction,
  tenant: string,
  opportunityId: string,
): Promise<IOpportunityDetail | null> {
  const opportunity = await OpportunityModel.getById(conn, tenant, opportunityId);
  if (!opportunity) return null;

  const db = tenantDb(conn, tenant);
  const [client, contact, contactPhone, owner, evidenceRows, quotes] = await Promise.all([
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
    loadActiveEvidenceWithCitations(db, opportunityId),
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
    contact_phone: contactPhone?.phone_number ?? null,
    contact_email: contact?.email ?? null,
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
        // A cited declaration is the rung's headline evidence when one exists.
        evidence: evidence.find((item) => item.checkpoint === checkpoint && item.ref_type)
          ?? evidence.find((item) => item.checkpoint === checkpoint)
          ?? null,
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
