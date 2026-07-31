import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type {
  IOpportunity,
  IOpportunitySuggestion,
  OpportunityGeneratorKey,
  OpportunitySuggestionStatus,
  OpportunityType,
} from '@alga-psa/types';
import type { z } from 'zod';
import { acceptSuggestionOverridesSchema } from '../schemas/opportunitySchemas';
import { OpportunityModel } from '../models/opportunityModel';
import { buildOpportunityCreatedPayload } from './opportunityEventBuilders';
import { publishOpportunityEventAfterCommit } from './opportunityEvents';

export type AcceptSuggestionOverrides = z.infer<typeof acceptSuggestionOverridesSchema>;

const opportunityTypeByGenerator: Record<OpportunityGeneratorKey, OpportunityType> = {
  renewal: 'renewal',
  tm_conversion: 'expansion',
  whitespace: 'expansion',
  asset_aging: 'project',
  'inbound-lead': 'new_logo',
};

const nextActionByGenerator: Record<OpportunityGeneratorKey, string> = {
  renewal: 'Start the renewal conversation',
  tm_conversion: 'Review the T&M comparison with the client',
  whitespace: 'Discuss the missing service category',
  asset_aging: 'Scope the asset refresh',
  'inbound-lead': 'Follow up on the inbound enquiry',
};

type SuggestionOpportunitySource = Pick<
  IOpportunitySuggestion,
  'suggestion_id' | 'client_id' | 'title' | 'generator_key' | 'evidence' | 'mrr_cents' | 'nrr_cents' | 'currency_code'
>;

export function buildAcceptedOpportunity(
  suggestion: SuggestionOpportunitySource,
  input: {
    opportunityNumber: string;
    actorId: string;
    accountManagerId?: string | null;
    overrides?: AcceptSuggestionOverrides;
    now: Date;
  },
): Omit<IOpportunity, 'tenant' | 'opportunity_id'> {
  const overrides = input.overrides ?? {};
  const nowIso = input.now.toISOString();
  const generatorKey = suggestion.generator_key;
  return {
    opportunity_number: input.opportunityNumber,
    client_id: suggestion.client_id,
    contact_id: overrides.contact_id ?? null,
    title: overrides.title ?? suggestion.title,
    opportunity_type: opportunityTypeByGenerator[generatorKey],
    owner_id: overrides.owner_id ?? input.accountManagerId ?? input.actorId,
    status: 'open',
    stage: 'identified',
    confidence: 'medium',
    mrr_cents: overrides.mrr_cents ?? suggestion.mrr_cents,
    nrr_cents: overrides.nrr_cents ?? suggestion.nrr_cents,
    hardware_cents: overrides.hardware_cents ?? 0,
    currency_code: overrides.currency_code ?? suggestion.currency_code,
    values_locked_by_quote: false,
    expected_close_date: overrides.expected_close_date ?? null,
    next_action: overrides.next_action ?? nextActionByGenerator[generatorKey],
    next_action_due: overrides.next_action_due
      ?? new Date(input.now.getTime() + 7 * 86_400_000).toISOString(),
    last_activity_at: nowIso,
    loss_reason: null,
    loss_notes: null,
    lost_to: null,
    generator_key: generatorKey,
    generator_context: suggestion.evidence,
    suggestion_id: suggestion.suggestion_id,
    converted_contract_id: null,
    converted_project_id: null,
    won_at: null,
    lost_at: null,
    created_by: input.actorId,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function normalizeSuggestion(row: Record<string, unknown>): IOpportunitySuggestion {
  return {
    ...row,
    tenant: String(row.tenant),
    suggestion_id: String(row.suggestion_id),
    generator_key: row.generator_key as OpportunityGeneratorKey,
    client_id: String(row.client_id),
    title: String(row.title),
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
    mrr_cents: Number(row.mrr_cents ?? 0),
    nrr_cents: Number(row.nrr_cents ?? 0),
    currency_code: String(row.currency_code),
    status: row.status as OpportunitySuggestionStatus,
    snoozed_until: row.snoozed_until
      ? row.snoozed_until instanceof Date
        ? row.snoozed_until.toISOString()
        : String(row.snoozed_until)
      : null,
    dedupe_key: String(row.dedupe_key),
    created_opportunity_id: row.created_opportunity_id ? String(row.created_opportunity_id) : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  } as IOpportunitySuggestion;
}

async function nextOpportunityNumber(trx: Knex.Transaction, tenant: string): Promise<string> {
  const result = await trx.raw(
    'SELECT generate_next_number(:tenant::uuid, :type::text) as number',
    { tenant, type: 'OPPORTUNITY' },
  );
  const number = result?.rows?.[0]?.number;
  if (!number) throw new Error('Failed to generate opportunity number');
  return number;
}

export async function listSuggestionsInternal(
  knex: Knex,
  tenant: string,
  status?: OpportunitySuggestionStatus,
): Promise<IOpportunitySuggestion[]> {
  const query = tenantDb(knex, tenant).table('opportunity_suggestions')
    .orderBy('created_at', 'desc');
  if (status) query.where({ status });
  const rows = await query;
  return rows.map((row: Record<string, unknown>) => normalizeSuggestion(row));
}

export async function acceptSuggestionInternal(
  knex: Knex,
  tenant: string,
  suggestionId: string,
  actorId: string,
  rawOverrides: AcceptSuggestionOverrides = {},
): Promise<IOpportunity> {
  const overrides = acceptSuggestionOverridesSchema.parse(rawOverrides);
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const suggestion = await db.table('opportunity_suggestions')
      .where({ suggestion_id: suggestionId })
      .forUpdate()
      .first();
    if (!suggestion) throw new Error('Suggestion not found');
    if (suggestion.status === 'accepted') throw new Error('Suggestion has already been accepted');
    if (suggestion.status === 'dismissed') throw new Error('Dismissed suggestions cannot be accepted');

    const client = await db.table('clients')
      .where({ client_id: suggestion.client_id })
      .select('client_id', 'account_manager_id')
      .first();
    if (!client) throw new Error('Client not found');
    if (overrides.contact_id) {
      const contact = await db.table('contacts')
        .where({ contact_name_id: overrides.contact_id, client_id: suggestion.client_id })
        .select('contact_name_id')
        .first();
      if (!contact) throw new Error('Contact not found for client');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const generatorKey = suggestion.generator_key as OpportunityGeneratorKey;
    const opportunity = await OpportunityModel.create(trx, tenant, buildAcceptedOpportunity({
      ...normalizeSuggestion(suggestion),
      generator_key: generatorKey,
    }, {
      opportunityNumber: await nextOpportunityNumber(trx, tenant),
      actorId,
      accountManagerId: client.account_manager_id,
      overrides,
      now,
    }));

    await db.table('opportunity_suggestions')
      .where({ suggestion_id: suggestionId })
      .update({
        status: 'accepted',
        snoozed_until: null,
        created_opportunity_id: opportunity.opportunity_id,
        updated_at: nowIso,
      });

    // Marketing touchpoints logged before the deal existed are its courtship
    // record: link the suggestion contact's marketing interactions to the new
    // opportunity so its timeline starts at first touch.
    const evidenceContactId = overrides.contact_id
      ?? (suggestion.evidence && typeof suggestion.evidence === 'object'
        ? (suggestion.evidence as { contactId?: string }).contactId ?? null
        : null);
    if (evidenceContactId) {
      await db.table('interactions')
        .where({ contact_name_id: evidenceContactId, category: 'marketing' })
        .whereNull('opportunity_id')
        .update({ opportunity_id: opportunity.opportunity_id });
    }
    publishOpportunityEventAfterCommit(
      trx,
      tenant,
      'OPPORTUNITY_CREATED',
      buildOpportunityCreatedPayload({
        opportunityId: opportunity.opportunity_id,
        clientId: opportunity.client_id,
        ownerId: opportunity.owner_id,
        stage: opportunity.stage,
        createdAt: nowIso,
      }),
      `opportunity_created:${opportunity.opportunity_id}`,
    );
    return opportunity;
  });
}

export async function dismissSuggestionInternal(
  knex: Knex,
  tenant: string,
  suggestionId: string,
): Promise<IOpportunitySuggestion> {
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const current = await db.table('opportunity_suggestions')
      .where({ suggestion_id: suggestionId })
      .forUpdate()
      .first();
    if (!current) throw new Error('Suggestion not found');
    if (current.status === 'accepted') throw new Error('Accepted suggestions cannot be dismissed');
    const [updated] = await db.table('opportunity_suggestions')
      .where({ suggestion_id: suggestionId })
      .update({ status: 'dismissed', snoozed_until: null, updated_at: new Date().toISOString() })
      .returning('*');
    return normalizeSuggestion(updated);
  });
}

export async function snoozeSuggestionInternal(
  knex: Knex,
  tenant: string,
  suggestionId: string,
  until: string,
): Promise<IOpportunitySuggestion> {
  const untilDate = new Date(until);
  if (!Number.isFinite(untilDate.getTime()) || untilDate.getTime() <= Date.now()) {
    throw new Error('Snooze date must be in the future');
  }
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const current = await db.table('opportunity_suggestions')
      .where({ suggestion_id: suggestionId })
      .forUpdate()
      .first();
    if (!current) throw new Error('Suggestion not found');
    if (current.status === 'accepted' || current.status === 'dismissed') {
      throw new Error('Accepted or dismissed suggestions cannot be snoozed');
    }
    const [updated] = await db.table('opportunity_suggestions')
      .where({ suggestion_id: suggestionId })
      .update({
        status: 'snoozed',
        snoozed_until: untilDate.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning('*');
    return normalizeSuggestion(updated);
  });
}
