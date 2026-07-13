'use server';

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IOpportunity, IOpportunityDetail, IOpportunityEvidence, IOpportunityHandoff, IQuote, OpportunityListFilters } from '@alga-psa/types';
import { createOpportunitySchema, updateOpportunitySchema, loseOpportunitySchema, completeNextActionSchema, opportunityListFiltersSchema, winOpportunitySchema } from '../schemas/opportunitySchemas';
import { OpportunityModel } from '../models/opportunityModel';
import { correctEvidence, recordEvidence } from '../lib/stageEngine';
import { onQuoteAccepted, onQuoteSent, recomputeAcceptedQuoteValues } from '../lib/quoteLifecycleHooks';
import { buildOpportunityCreatedPayload, buildOpportunityStatusChangedPayload } from '../lib/opportunityEventBuilders';
import { publishOpportunityEventAfterCommit } from '../lib/opportunityEvents';
import { completeOpportunityNextAction } from '../lib/completedActionInteraction';
import type { OpportunityListResult } from '../models/opportunityModel';
import { getOpportunityDetail } from '../lib/opportunityDetail';
import {
  ensureEnterpriseOpportunityCloseGatesRegistered,
  runOpportunityCloseGates,
} from '../lib/closeGates';
import { prepareOpportunityWinConversions, type WinOpportunityOptions } from '../lib/opportunityWin';
import { getOpportunityHandoffData } from '../lib/opportunityHandoff';

async function requirePermission(user: unknown, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!await hasPermission(user as any, 'opportunities', action)) throw new Error(`Permission denied: opportunities ${action} required`);
}

async function nextOpportunityNumber(trx: Knex.Transaction, tenant: string): Promise<string> {
  const result = await trx.raw('SELECT generate_next_number(:tenant::uuid, :type::text) as number', { tenant, type: 'OPPORTUNITY' });
  const number = result?.rows?.[0]?.number;
  if (!number) throw new Error('Failed to generate opportunity number');
  return number;
}

function actorId(user: any): string {
  const id = user?.user_id;
  if (!id) throw new Error('user is not logged in');
  return id;
}

export const createOpportunity = withAuth(async (user, { tenant }, input: unknown): Promise<IOpportunity> => {
  await requirePermission(user, 'create');
  const data = createOpportunitySchema.parse(input);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const client = await tenantDb(trx, tenant).table('clients').where({ client_id: data.client_id }).select('client_id', 'account_manager_id').first();
    if (!client) throw new Error('Client not found');
    if (data.contact_id) {
      const contact = await tenantDb(trx, tenant).table('contacts').where({ contact_name_id: data.contact_id, client_id: data.client_id }).first();
      if (!contact) throw new Error('Contact not found for client');
    }
    const now = new Date().toISOString();
    const ownerId = data.owner_id ?? client.account_manager_id ?? actorId(user);
    const created = await OpportunityModel.create(trx, tenant, {
      opportunity_number: await nextOpportunityNumber(trx, tenant),
      ...data,
      owner_id: ownerId,
      status: 'open', stage: 'identified', values_locked_by_quote: false,
      last_activity_at: now, loss_reason: null, loss_notes: null, lost_to: null,
      converted_contract_id: null, converted_project_id: null, won_at: null, lost_at: null,
      created_by: actorId(user), created_at: now, updated_at: now,
    } as Omit<IOpportunity, 'tenant' | 'opportunity_id'>);
    const payload = buildOpportunityCreatedPayload({ opportunityId: created.opportunity_id, clientId: created.client_id, ownerId: created.owner_id, stage: created.stage, createdAt: now });
    publishOpportunityEventAfterCommit(trx, tenant, 'OPPORTUNITY_CREATED', payload, `opportunity_created:${created.opportunity_id}`);
    return created;
  });
});

export const updateOpportunity = withAuth(async (user, { tenant }, opportunityId: string, input: unknown): Promise<IOpportunity> => {
  await requirePermission(user, 'update');
  const data = updateOpportunitySchema.parse(input);
  const { client_id: _client, generator_key: _generator, generator_context: _context, suggestion_id: _suggestion, ...allowed } = data;
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const current = await OpportunityModel.getById(trx, tenant, opportunityId);
    if (!current) throw new Error('Opportunity not found');
    if (current.values_locked_by_quote && (allowed.mrr_cents !== undefined || allowed.nrr_cents !== undefined || allowed.hardware_cents !== undefined || allowed.currency_code !== undefined)) {
      throw new Error('Opportunity values are locked by an accepted quote');
    }
    return OpportunityModel.update(trx, tenant, opportunityId, {
      ...allowed,
      ...(allowed.next_action_due !== undefined ? { overdue_notified_at: null } : {}),
    } as Partial<IOpportunity>);
  });
});

export const completeNextAction = withAuth(async (user, { tenant }, opportunityId: string, input: unknown): Promise<IOpportunity> => {
  await requirePermission(user, 'update');
  const data = completeNextActionSchema.parse(input);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx) => completeOpportunityNextAction(
    trx,
    tenant,
    opportunityId,
    data as { next_action: string; next_action_due: string },
    actorId(user),
  ));
});

export const declareQualified = withAuth(async (user, { tenant }, opportunityId: string, detail?: string): Promise<IOpportunityEvidence> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx) => recordEvidence(trx, tenant, { opportunityId, checkpoint: 'qualified', source: 'declared', detail: detail?.trim() || 'Decision-maker and budget conversation confirmed', recordedBy: actorId(user) }));
});

export const correctOpportunityEvidence = withAuth(async (user, { tenant }, evidenceId: string, correctionNote: string): Promise<IOpportunityEvidence> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx) => correctEvidence(trx, tenant, evidenceId, correctionNote, actorId(user)));
});

async function closeOpportunity(trx: Knex.Transaction, tenant: string, opportunityId: string, status: 'won' | 'lost', patch: Partial<IOpportunity>): Promise<IOpportunity> {
  const current = await tenantDb(trx, tenant).table('opportunities').where({ opportunity_id: opportunityId }).forUpdate().first<IOpportunity>();
  if (!current) throw new Error('Opportunity not found');
  if (current.status !== 'open') throw new Error('Only open opportunities can be closed');
  const changedAt = new Date().toISOString();
  const updated = await OpportunityModel.update(trx, tenant, opportunityId, { ...patch, status, stage: status, next_action: null, next_action_due: null });
  if (current.stage !== status) {
    publishOpportunityEventAfterCommit(trx, tenant, 'OPPORTUNITY_STAGE_CHANGED', {
      opportunityId, clientId: current.client_id, previousStage: current.stage, newStage: status, changedAt,
    }, `opportunity_stage_changed:${opportunityId}:${status}:${changedAt}`);
  }
  const payload = buildOpportunityStatusChangedPayload({ opportunityId, clientId: current.client_id, previousStatus: current.status, newStatus: status, changedAt });
  publishOpportunityEventAfterCommit(trx, tenant, 'OPPORTUNITY_STATUS_CHANGED', payload, `opportunity_status_changed:${opportunityId}:${status}:${changedAt}`);
  return updated;
}

export const winOpportunity = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  options: WinOpportunityOptions = {},
): Promise<IOpportunity> => {
  await requirePermission(user, 'update');
  const data = winOpportunitySchema.parse(options);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    await ensureEnterpriseOpportunityCloseGatesRegistered();
    await runOpportunityCloseGates(trx, tenant, opportunityId);
    const conversions = await prepareOpportunityWinConversions(
      trx,
      tenant,
      opportunityId,
      actorId(user),
      data,
    );
    const now = new Date().toISOString();
    const updated = await closeOpportunity(trx, tenant, opportunityId, 'won', {
      won_at: now,
      ...conversions,
    });
    await recordEvidence(trx, tenant, { opportunityId, checkpoint: 'won', source: 'declared', detail: 'Opportunity marked won', recordedBy: actorId(user) });
    const client = await tenantDb(trx, tenant).table('clients').where({ client_id: updated.client_id }).first();
    if (client?.lifecycle_status === 'prospect') {
      await tenantDb(trx, tenant).table('clients').where({ client_id: updated.client_id }).update({ lifecycle_status: 'active', updated_at: now });
      publishOpportunityEventAfterCommit(trx, tenant, 'CLIENT_STATUS_CHANGED', { clientId: updated.client_id, previousStatus: 'prospect', newStatus: 'active', changedAt: now }, `client_status_changed:${updated.client_id}:${now}`);
    }
    return updated;
  });
});

export const loseOpportunity = withAuth(async (user, { tenant }, opportunityId: string, input: unknown): Promise<IOpportunity> => {
  await requirePermission(user, 'update');
  const data = loseOpportunitySchema.parse(input);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx) => closeOpportunity(trx, tenant, opportunityId, 'lost', { ...data, lost_at: new Date().toISOString() }));
});

export const listOpportunities = withAuth(async (
  user,
  { tenant },
  input: OpportunityListFilters = {},
): Promise<OpportunityListResult> => {
  await requirePermission(user, 'read');
  const filters = opportunityListFiltersSchema.parse(input);
  const { knex } = await createTenantKnex();
  return OpportunityModel.list(knex, tenant, filters);
});

export const deleteOpportunity = withAuth(async (user, { tenant }, opportunityId: string): Promise<void> => {
  await requirePermission(user, 'delete');
  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx) => {
    const linkedQuote = await tenantDb(trx, tenant).table('quotes').where({ opportunity_id: opportunityId }).first();
    if (linkedQuote) throw new Error('Unlink quotes before deleting an opportunity');
    if (!await OpportunityModel.delete(trx, tenant, opportunityId)) throw new Error('Open opportunity not found');
  });
});

export const getOpportunity = withAuth(async (user, { tenant }, opportunityId: string): Promise<IOpportunityDetail> => {
  await requirePermission(user, 'read');
  const { knex } = await createTenantKnex();
  const opportunity = await getOpportunityDetail(knex, tenant, opportunityId);
  if (!opportunity) throw new Error('Opportunity not found');
  return opportunity;
});

export const getOpportunityHandoff = withAuth(async (
  user,
  { tenant },
  projectId: string,
): Promise<IOpportunityHandoff> => {
  if (!await hasPermission(user as any, 'project', 'read')) {
    throw new Error('Permission denied: project read required');
  }
  const { knex } = await createTenantKnex();
  const handoff = await getOpportunityHandoffData(knex, tenant, projectId);
  if (!handoff) throw new Error('Opportunity handoff not found');
  return handoff;
});

export const linkQuoteToOpportunity = withAuth(async (user, { tenant }, opportunityId: string, quoteId: string): Promise<IQuote> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const opportunity = await OpportunityModel.getById(trx, tenant, opportunityId);
    if (!opportunity) throw new Error('Opportunity not found');
    const quote = await tenantDb(trx, tenant).table('quotes').where({ quote_id: quoteId }).forUpdate().first<IQuote>();
    if (!quote) throw new Error('Quote not found');
    if (quote.client_id !== opportunity.client_id) throw new Error('Quote and opportunity must belong to the same client');
    const [linked] = await tenantDb(trx, tenant).table('quotes').where({ quote_id: quoteId }).update({ opportunity_id: opportunityId, updated_at: new Date().toISOString() }).returning('*') as IQuote[];
    if (linked.status === 'sent') await onQuoteSent(trx, linked);
    if (linked.status === 'accepted' || linked.status === 'converted') await onQuoteAccepted(trx, linked);
    return linked;
  });
});

export const unlinkQuoteFromOpportunity = withAuth(async (user, { tenant }, opportunityId: string, quoteId: string): Promise<void> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const quote = await db.table('quotes').where({ quote_id: quoteId, opportunity_id: opportunityId }).forUpdate().first();
    if (!quote) throw new Error('Linked quote not found');
    const evidence = await db.table('opportunity_evidence')
      .where({ opportunity_id: opportunityId, ref_type: 'quote', ref_id: quoteId })
      .whereNull('corrected_at')
      .select('evidence_id');
    for (const item of evidence) {
      await correctEvidence(trx, tenant, item.evidence_id, `Quote ${quote.quote_number ?? quoteId} unlinked`, actorId(user));
    }
    await db.table('quotes').where({ quote_id: quoteId }).update({ opportunity_id: null, updated_at: new Date().toISOString() });
    await recomputeAcceptedQuoteValues(trx, tenant, opportunityId);
  });
});
