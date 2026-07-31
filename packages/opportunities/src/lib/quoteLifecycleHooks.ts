import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IQuote, IQuoteItem } from '@alga-psa/types';
import { recordEvidence } from './stageEngine';
import { getOpportunitySettings } from '../models/opportunitySettingsModel';

export function quoteContainsAssessmentService(
  items: Array<Pick<IQuoteItem, 'is_selected' | 'service_id'>>,
  assessmentServiceIds: readonly string[],
): boolean {
  if (assessmentServiceIds.length === 0) return false;
  const mapped = new Set(assessmentServiceIds);
  return items.some((item) => item.is_selected && item.service_id != null && mapped.has(item.service_id));
}

interface AssessmentEvidenceDependencies {
  loadAssessmentServiceIds(
    trx: Knex.Transaction,
    tenant: string,
  ): Promise<string[]>;
  loadSelectedQuoteItems(
    trx: Knex.Transaction,
    tenant: string,
    quoteId: string,
  ): Promise<Array<Pick<IQuoteItem, 'is_selected' | 'service_id'>>>;
  record: typeof recordEvidence;
}

const assessmentEvidenceDependencies: AssessmentEvidenceDependencies = {
  async loadAssessmentServiceIds(trx, tenant) {
    return (await getOpportunitySettings(trx, tenant)).assessment_service_ids;
  },
  async loadSelectedQuoteItems(trx, tenant, quoteId) {
    const rows = await tenantDb(trx, tenant).table('quote_items')
      .where({ quote_id: quoteId, is_selected: true })
      .whereNotNull('service_id')
      .select('service_id') as Array<Pick<IQuoteItem, 'service_id'>>;
    return rows.map((item) => ({ ...item, is_selected: true }));
  },
  record: recordEvidence,
};

export async function recordAssessmentEvidenceForAcceptedQuote(
  trx: Knex.Transaction,
  quote: IQuote,
  tenant: string,
  opportunityId: string,
  dependencies: AssessmentEvidenceDependencies = assessmentEvidenceDependencies,
): Promise<boolean> {
  const assessmentServiceIds = await dependencies.loadAssessmentServiceIds(trx, tenant);
  if (assessmentServiceIds.length === 0) return false;
  const items = await dependencies.loadSelectedQuoteItems(trx, tenant, quote.quote_id);
  if (!quoteContainsAssessmentService(items, assessmentServiceIds)) return false;
  await dependencies.record(trx, tenant, {
    opportunityId,
    checkpoint: 'assessment',
    source: 'system',
    refType: 'quote',
    refId: quote.quote_id,
    detail: `Assessment service accepted on quote ${quote.quote_number ?? quote.quote_id}`,
  });
  return true;
}

export function deriveAcceptedQuoteValues(items: IQuoteItem[]): { mrr_cents: number; nrr_cents: number; hardware_cents: number } {
  return items.filter((item) => item.is_selected).reduce((totals, item) => {
    const amount = Number(item.net_amount ?? item.total_price ?? 0);
    if (item.is_recurring) totals.mrr_cents += amount;
    else if (item.service_item_kind === 'product') totals.hardware_cents += amount;
    else totals.nrr_cents += amount;
    return totals;
  }, { mrr_cents: 0, nrr_cents: 0, hardware_cents: 0 });
}

export async function recomputeAcceptedQuoteValues(trx: Knex.Transaction, tenant: string, opportunityId: string): Promise<void> {
  const acceptedQuotes = await tenantDb(trx, tenant).table('quotes')
    .where({ opportunity_id: opportunityId })
    .whereIn('status', ['accepted', 'converted'])
    .select('currency_code') as Array<{ currency_code: string }>;
  const rows = await tenantDb(trx, tenant).table('quote_items as qi')
    .join('quotes as q', function () {
      this.on('q.quote_id', '=', 'qi.quote_id').andOn('q.tenant', '=', 'qi.tenant');
    })
    .where('q.opportunity_id', opportunityId)
    .whereIn('q.status', ['accepted', 'converted'])
    .where('qi.is_selected', true)
    .select('qi.*', 'q.currency_code') as Array<IQuoteItem & { currency_code: string }>;
  const currencies = [...new Set(acceptedQuotes.map((row) => row.currency_code))];
  if (currencies.length > 1) throw new Error('Accepted quotes linked to an opportunity must use one currency');
  const values = deriveAcceptedQuoteValues(rows);
  await tenantDb(trx, tenant).table('opportunities').where({ opportunity_id: opportunityId }).update({
    ...values,
    ...(currencies[0] ? { currency_code: currencies[0] } : {}),
    values_locked_by_quote: acceptedQuotes.length > 0,
    updated_at: new Date().toISOString(),
  });
}

function linkedContext(quote: IQuote): { tenant: string; opportunityId: string } | null {
  if (!quote.opportunity_id) return null;
  if (!quote.tenant) throw new Error('Tenant context is required for quote lifecycle hooks');
  return { tenant: quote.tenant, opportunityId: quote.opportunity_id };
}

export async function onQuoteSent(trx: Knex.Transaction, quote: IQuote): Promise<void> {
  const context = linkedContext(quote);
  if (!context) return;
  const occurredAt = quote.sent_at ?? new Date().toISOString();
  await recordEvidence(trx, context.tenant, { opportunityId: context.opportunityId, checkpoint: 'proposed', source: 'system', refType: 'quote', refId: quote.quote_id, detail: `Quote ${quote.quote_number ?? quote.quote_id} sent` });
  await tenantDb(trx, context.tenant).table('opportunities').where({ opportunity_id: context.opportunityId }).update({ last_activity_at: occurredAt, updated_at: occurredAt });
}

export async function onQuoteAccepted(trx: Knex.Transaction, quote: IQuote): Promise<void> {
  const context = linkedContext(quote);
  if (!context) return;
  const occurredAt = quote.accepted_at ?? new Date().toISOString();
  await recordAssessmentEvidenceForAcceptedQuote(
    trx,
    quote,
    context.tenant,
    context.opportunityId,
  );
  await recordEvidence(trx, context.tenant, { opportunityId: context.opportunityId, checkpoint: 'verbal', source: 'system', refType: 'quote', refId: quote.quote_id, detail: `Quote ${quote.quote_number ?? quote.quote_id} accepted` });
  await recomputeAcceptedQuoteValues(trx, context.tenant, context.opportunityId);
  await tenantDb(trx, context.tenant).table('opportunities').where({ opportunity_id: context.opportunityId }).update({ last_activity_at: occurredAt, updated_at: occurredAt });
}
