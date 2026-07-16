import type { Knex } from 'knex';
import { SharedNumberingService } from '@shared/services/numberingService';
import {
  BaseService,
  type ListOptions,
  type ListResult,
  type ServiceContext,
  tenantDb,
  withTransaction,
} from '@alga-psa/db';
import type {
  IOpportunity,
  IOpportunityDetail,
  IOpportunityEvidence,
  IOpportunityListItem,
  IOpportunitySuggestion,
  IQuote,
  OpportunityListFilters,
  OpportunitySuggestionStatus,
  IWorkQueue,
} from '@alga-psa/types';
import {
  OpportunityModel,
  assembleWorkQueue,
  buildOpportunityCreatedPayload,
  buildOpportunityStatusChangedPayload,
  completeOpportunityNextAction,
  correctEvidence,
  getOpportunityDetail,
  onQuoteAccepted,
  onQuoteSent,
  publishOpportunityEventAfterCommit,
  recomputeAcceptedQuoteValues,
  recordEvidence,
  acceptSuggestionInternal,
  dismissSuggestionInternal,
  listSuggestionsInternal,
  snoozeSuggestionInternal,
  ensureEnterpriseOpportunityCloseGatesRegistered,
  runOpportunityCloseGates,
  prepareOpportunityWinConversions,
  listOpportunityTimelineCore,
  type IOpportunityTimelineEntry,
} from '@alga-psa/opportunities';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../middleware/apiMiddleware';
import type {
  CompleteOpportunityActionApi,
  CorrectOpportunityEvidenceApi,
  CreateOpportunityApi,
  DeclaredOpportunityEvidenceApi,
  LoseOpportunityApi,
  UpdateOpportunityApi,
  AcceptOpportunitySuggestionApi,
  WinOpportunityApi,
} from '../schemas/opportunitySchemas';

export interface OpportunityListOptions extends ListOptions, OpportunityListFilters {
}

function throwOpportunityApiError(error: unknown): never {
  if (!(error instanceof Error)) throw error;

  if ([
    'Opportunity not found',
    'Quote not found',
    'Linked quote not found',
    'Active opportunity evidence not found',
    'Suggestion not found',
  ].includes(error.message)) {
    throw new NotFoundError(error.message);
  }

  if ([
    'Client not found',
    'Contact not found for client',
  ].includes(error.message)) {
    throw new ValidationError(error.message);
  }

  if (
    error.message === 'Only open opportunities have next actions' ||
    error.message === 'Opportunity has no current next action to complete' ||
    error.message === 'Only open opportunities can be closed' ||
    error.message === 'Only open opportunities can be deleted' ||
    error.message === 'Opportunity values are locked by an accepted quote' ||
    error.message === 'Unlink quotes before deleting an opportunity' ||
    error.message === 'Quote and opportunity must belong to the same client' ||
    error.message === 'Suggestion has already been accepted' ||
    error.message === 'Dismissed suggestions cannot be accepted' ||
    error.message === 'Accepted suggestions cannot be dismissed' ||
    error.message === 'Accepted or dismissed suggestions cannot be snoozed' ||
    error.message === 'Conversion quote must be linked to the opportunity' ||
    error.message === 'Conversion quote must be accepted' ||
    error.message === 'Project creation from a template is not yet available in the opportunity win flow' ||
    error.message.startsWith('Resolve or decline ')
  ) {
    throw new ConflictError(error.message);
  }

  throw error;
}

async function nextOpportunityNumber(trx: Knex.Transaction, tenant: string): Promise<string> {
  return SharedNumberingService.getNextNumber('OPPORTUNITY', { knex: trx, tenant });
}

export class OpportunityService extends BaseService<IOpportunity | IOpportunityListItem> {
  constructor() {
    super({
      tableName: 'opportunities',
      primaryKey: 'opportunity_id',
      tenantColumn: 'tenant',
      auditFields: {
        createdBy: 'created_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      searchableFields: ['title', 'opportunity_number'],
      defaultSort: 'next_action_due',
      defaultOrder: 'asc',
    });
  }

  async list(
    options: OpportunityListOptions,
    context: ServiceContext,
  ): Promise<ListResult<IOpportunityListItem>> {
    const knex = await this.getDbForContext(context);
    const filters: OpportunityListFilters = {
      status: options.status,
      stage: options.stage,
      owner_id: options.owner_id,
      client_id: options.client_id,
      opportunity_type: options.opportunity_type,
      stalled_only: options.stalled_only,
      search: options.search,
      page: options.page,
      page_size: options.page_size ?? options.limit,
      sort_by: options.sort_by,
      sort_direction: options.sort_direction ?? options.order,
    };

    const result = await OpportunityModel.list(
      knex,
      context.tenant,
      filters,
    );
    return { data: result.data, total: result.total };
  }

  async getWorkQueue(context: ServiceContext): Promise<IWorkQueue> {
    const knex = await this.getDbForContext(context);
    return assembleWorkQueue(
      knex,
      context.tenant,
      context.userId,
      String(context.user?.first_name ?? ''),
    );
  }

  async listTimeline(
    id: string,
    context: ServiceContext,
  ): Promise<IOpportunityTimelineEntry[]> {
    const knex = await this.getDbForContext(context);
    const opportunity = await tenantDb(knex, context.tenant).table('opportunities')
      .where({ opportunity_id: id })
      .select('opportunity_id')
      .first();
    if (!opportunity) throw new NotFoundError('Opportunity not found');

    return listOpportunityTimelineCore(knex, context.tenant, id);
  }

  async listSuggestions(
    status: OpportunitySuggestionStatus | undefined,
    context: ServiceContext,
  ): Promise<IOpportunitySuggestion[]> {
    const knex = await this.getDbForContext(context);
    return listSuggestionsInternal(knex, context.tenant, status);
  }

  async acceptSuggestion(
    suggestionId: string,
    data: AcceptOpportunitySuggestionApi,
    context: ServiceContext,
  ): Promise<IOpportunity> {
    const knex = await this.getDbForContext(context);
    return acceptSuggestionInternal(knex, context.tenant, suggestionId, context.userId, data)
      .catch(throwOpportunityApiError);
  }

  async dismissSuggestion(
    suggestionId: string,
    context: ServiceContext,
  ): Promise<IOpportunitySuggestion> {
    const knex = await this.getDbForContext(context);
    return dismissSuggestionInternal(knex, context.tenant, suggestionId)
      .catch(throwOpportunityApiError);
  }

  async snoozeSuggestion(
    suggestionId: string,
    until: string,
    context: ServiceContext,
  ): Promise<IOpportunitySuggestion> {
    const knex = await this.getDbForContext(context);
    return snoozeSuggestionInternal(knex, context.tenant, suggestionId, until)
      .catch(throwOpportunityApiError);
  }

  async getById(id: string, context: ServiceContext): Promise<IOpportunityDetail | null> {
    const knex = await this.getDbForContext(context);
    return getOpportunityDetail(knex, context.tenant, id);
  }

  async listEvidence(id: string, context: ServiceContext): Promise<IOpportunityEvidence[]> {
    const knex = await this.getDbForContext(context);
    const db = tenantDb(knex, context.tenant);
    const opportunity = await db.table('opportunities')
      .where({ opportunity_id: id })
      .select('opportunity_id')
      .first();
    if (!opportunity) throw new NotFoundError('Opportunity not found');
    return db.table('opportunity_evidence')
      .where({ opportunity_id: id })
      .orderBy('recorded_at', 'asc') as Promise<IOpportunityEvidence[]>;
  }

  async create(data: CreateOpportunityApi, context: ServiceContext): Promise<IOpportunity> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, context.tenant);
      const client = await db.table('clients')
        .where({ client_id: data.client_id })
        .select('client_id', 'account_manager_id')
        .first();
      if (!client) throw new Error('Client not found');

      if (data.contact_id) {
        const contact = await db.table('contacts')
          .where({ contact_name_id: data.contact_id, client_id: data.client_id })
          .select('contact_name_id')
          .first();
        if (!contact) throw new Error('Contact not found for client');
      }

      const now = new Date().toISOString();
      const ownerId = data.owner_id ?? client.account_manager_id ?? context.userId;
      const created = await OpportunityModel.create(trx, context.tenant, {
        opportunity_number: await nextOpportunityNumber(trx, context.tenant),
        ...data,
        owner_id: ownerId,
        status: 'open',
        stage: 'identified',
        values_locked_by_quote: false,
        last_activity_at: now,
        loss_reason: null,
        loss_notes: null,
        lost_to: null,
        converted_contract_id: null,
        converted_project_id: null,
        won_at: null,
        lost_at: null,
        created_by: context.userId,
        created_at: now,
        updated_at: now,
      } as Omit<IOpportunity, 'tenant' | 'opportunity_id'>);

      publishOpportunityEventAfterCommit(
        trx,
        context.tenant,
        'OPPORTUNITY_CREATED',
        buildOpportunityCreatedPayload({
          opportunityId: created.opportunity_id,
          clientId: created.client_id,
          ownerId: created.owner_id,
          stage: created.stage,
          createdAt: now,
        }),
        `opportunity_created:${created.opportunity_id}`,
      );
      return created;
    }).catch(throwOpportunityApiError);
  }

  async update(id: string, data: UpdateOpportunityApi, context: ServiceContext): Promise<IOpportunity> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const current = await OpportunityModel.getById(trx, context.tenant, id);
      if (!current) throw new Error('Opportunity not found');

      const {
        client_id: _clientId,
        generator_key: _generatorKey,
        generator_context: _generatorContext,
        suggestion_id: _suggestionId,
        ...allowed
      } = data;
      if (
        current.values_locked_by_quote &&
        (allowed.mrr_cents !== undefined ||
          allowed.nrr_cents !== undefined ||
          allowed.hardware_cents !== undefined ||
          allowed.currency_code !== undefined)
      ) {
        throw new Error('Opportunity values are locked by an accepted quote');
      }

      return OpportunityModel.update(trx, context.tenant, id, {
        ...allowed,
        ...(allowed.next_action_due !== undefined ? { overdue_notified_at: null } : {}),
      } as Partial<IOpportunity>);
    }).catch(throwOpportunityApiError);
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    await withTransaction(knex, async (trx) => {
      const current = await OpportunityModel.getById(trx, context.tenant, id);
      if (!current) throw new Error('Opportunity not found');
      if (current.status !== 'open') throw new Error('Only open opportunities can be deleted');

      const linkedQuote = await tenantDb(trx, context.tenant).table('quotes')
        .where({ opportunity_id: id })
        .select('quote_id')
        .first();
      if (linkedQuote) throw new Error('Unlink quotes before deleting an opportunity');

      if (!await OpportunityModel.delete(trx, context.tenant, id)) {
        throw new Error('Only open opportunities can be deleted');
      }
    }).catch(throwOpportunityApiError);
  }

  private async closeOpportunity(
    trx: Knex.Transaction,
    context: ServiceContext,
    opportunityId: string,
    status: 'won' | 'lost',
    patch: Partial<IOpportunity>,
  ): Promise<IOpportunity> {
    const current = await tenantDb(trx, context.tenant).table('opportunities')
      .where({ opportunity_id: opportunityId })
      .forUpdate()
      .first<IOpportunity>();
    if (!current) throw new Error('Opportunity not found');
    if (current.status !== 'open') throw new Error('Only open opportunities can be closed');

    const changedAt = new Date().toISOString();
    const updated = await OpportunityModel.update(trx, context.tenant, opportunityId, {
      ...patch,
      status,
      stage: status,
      next_action: null,
      next_action_due: null,
    });

    if (current.stage !== status) {
      publishOpportunityEventAfterCommit(trx, context.tenant, 'OPPORTUNITY_STAGE_CHANGED', {
        opportunityId,
        clientId: current.client_id,
        previousStage: current.stage,
        newStage: status,
        changedAt,
      }, `opportunity_stage_changed:${opportunityId}:${status}:${changedAt}`);
    }
    publishOpportunityEventAfterCommit(
      trx,
      context.tenant,
      'OPPORTUNITY_STATUS_CHANGED',
      buildOpportunityStatusChangedPayload({
        opportunityId,
        clientId: current.client_id,
        previousStatus: current.status,
        newStatus: status,
        changedAt,
      }),
      `opportunity_status_changed:${opportunityId}:${status}:${changedAt}`,
    );
    return updated;
  }

  async win(id: string, data: WinOpportunityApi, context: ServiceContext): Promise<IOpportunity> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      await ensureEnterpriseOpportunityCloseGatesRegistered();
      await runOpportunityCloseGates(trx, context.tenant, id);
      const conversions = await prepareOpportunityWinConversions(
        trx,
        context.tenant,
        id,
        context.userId,
        data,
      );
      const now = new Date().toISOString();
      const updated = await this.closeOpportunity(trx, context, id, 'won', {
        won_at: now,
        ...conversions,
      });
      await recordEvidence(trx, context.tenant, {
        opportunityId: id,
        checkpoint: 'won',
        source: 'declared',
        detail: 'Opportunity marked won',
        recordedBy: context.userId,
      });

      const db = tenantDb(trx, context.tenant);
      const client = await db.table('clients')
        .where({ client_id: updated.client_id })
        .select('lifecycle_status')
        .first();
      if (client?.lifecycle_status === 'prospect') {
        await db.table('clients')
          .where({ client_id: updated.client_id })
          .update({ lifecycle_status: 'active', updated_at: now });
        publishOpportunityEventAfterCommit(trx, context.tenant, 'CLIENT_STATUS_CHANGED', {
          clientId: updated.client_id,
          previousStatus: 'prospect',
          newStatus: 'active',
          changedAt: now,
        }, `client_status_changed:${updated.client_id}:${now}`);
      }
      return updated;
    }).catch(throwOpportunityApiError);
  }

  async lose(id: string, data: LoseOpportunityApi, context: ServiceContext): Promise<IOpportunity> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, (trx) => this.closeOpportunity(trx, context, id, 'lost', {
      ...data,
      lost_at: new Date().toISOString(),
    })).catch(throwOpportunityApiError);
  }

  async completeAction(
    id: string,
    data: CompleteOpportunityActionApi,
    context: ServiceContext,
  ): Promise<IOpportunity> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, (trx) => completeOpportunityNextAction(
      trx,
      context.tenant,
      id,
      data as { next_action: string; next_action_due: string },
      context.userId,
    )).catch(throwOpportunityApiError);
  }

  async recordDeclaredEvidence(
    id: string,
    data: DeclaredOpportunityEvidenceApi,
    context: ServiceContext,
  ): Promise<IOpportunityEvidence> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, (trx) => recordEvidence(trx, context.tenant, {
      opportunityId: id,
      checkpoint: data.checkpoint,
      source: 'declared',
      detail: data.detail?.trim() || 'Decision-maker and budget conversation confirmed',
      recordedBy: context.userId,
    })).catch(throwOpportunityApiError);
  }

  async correctEvidence(
    opportunityId: string,
    evidenceId: string,
    data: CorrectOpportunityEvidenceApi,
    context: ServiceContext,
  ): Promise<IOpportunityEvidence> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const evidence = await tenantDb(trx, context.tenant).table('opportunity_evidence')
        .where({ evidence_id: evidenceId, opportunity_id: opportunityId })
        .whereNull('corrected_at')
        .select('evidence_id')
        .first();
      if (!evidence) throw new Error('Active opportunity evidence not found');
      return correctEvidence(trx, context.tenant, evidenceId, data.correction_note, context.userId);
    }).catch(throwOpportunityApiError);
  }

  async linkQuote(opportunityId: string, quoteId: string, context: ServiceContext): Promise<IQuote> {
    const knex = await this.getDbForContext(context);
    return withTransaction(knex, async (trx) => {
      const opportunity = await OpportunityModel.getById(trx, context.tenant, opportunityId);
      if (!opportunity) throw new Error('Opportunity not found');
      const quote = await tenantDb(trx, context.tenant).table('quotes')
        .where({ quote_id: quoteId })
        .forUpdate()
        .first<IQuote>();
      if (!quote) throw new Error('Quote not found');
      if (quote.client_id !== opportunity.client_id) {
        throw new Error('Quote and opportunity must belong to the same client');
      }

      const [linked] = await tenantDb(trx, context.tenant).table('quotes')
        .where({ quote_id: quoteId })
        .update({ opportunity_id: opportunityId, updated_at: new Date().toISOString() })
        .returning('*') as IQuote[];
      if (linked.status === 'sent') await onQuoteSent(trx, linked);
      if (linked.status === 'accepted' || linked.status === 'converted') await onQuoteAccepted(trx, linked);
      return linked;
    }).catch(throwOpportunityApiError);
  }

  async unlinkQuote(opportunityId: string, quoteId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    await withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, context.tenant);
      const quote = await db.table('quotes')
        .where({ quote_id: quoteId, opportunity_id: opportunityId })
        .forUpdate()
        .first();
      if (!quote) throw new Error('Linked quote not found');

      const evidence = await db.table('opportunity_evidence')
        .where({ opportunity_id: opportunityId, ref_type: 'quote', ref_id: quoteId })
        .whereNull('corrected_at')
        .select('evidence_id');
      for (const item of evidence) {
        await correctEvidence(
          trx,
          context.tenant,
          item.evidence_id,
          `Quote ${quote.quote_number ?? quoteId} unlinked`,
          context.userId,
        );
      }

      await db.table('quotes')
        .where({ quote_id: quoteId })
        .update({ opportunity_id: null, updated_at: new Date().toISOString() });
      await recomputeAcceptedQuoteValues(trx, context.tenant, opportunityId);
    }).catch(throwOpportunityApiError);
  }
}
