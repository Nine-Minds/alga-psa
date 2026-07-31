import {
  BaseService,
  type ServiceContext,
  tenantDb,
} from '@alga-psa/db';
import type {
  IMarketingCampaign,
  IMarketingCampaignFunnel,
  IMarketingCaptureForm,
  IMarketingChannel,
  IMarketingContent,
  IMarketingSequence,
  IMarketingSequenceEnrollment,
  ISocialPost,
  ISocialPostQueueItem,
  ISocialPostTarget,
} from '@alga-psa/types';
import {
  listCampaignsInternal,
  getCampaignInternal,
  createCampaignInternal,
  updateCampaignInternal,
  getCampaignFunnelInternal,
  listContentInternal,
  getContentInternal,
  createContentInternal,
  updateContentInternal,
  deleteContentInternal,
  listChannelsInternal,
  createChannelInternal,
  updateChannelInternal,
  listFormsInternal,
  createFormInternal,
  updateFormInternal,
  createPostInternal,
  reschedulePostInternal,
  getQueueInternal,
  getAwaitingPublishInternal,
  markTargetPublishedInternal,
  skipTargetInternal,
  listSequencesInternal,
  getSequenceDetailInternal,
  createSequenceInternal,
  updateSequenceInternal,
  enrollContactInternal,
  unenrollContactInternal,
  type SequenceDetail,
} from '@alga-psa/marketing/lib';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../middleware/apiMiddleware';
import type {
  CreateCampaignApi,
  UpdateCampaignApi,
  CreateContentApi,
  UpdateContentApi,
  CreateChannelApi,
  UpdateChannelApi,
  CreateFormApi,
  UpdateFormApi,
  CreatePostApi,
  CreateSequenceApi,
  UpdateSequenceApi,
  PostQueueQuery,
} from '../schemas/marketingSchemas';

/**
 * Response DTO hygiene: internal rows carry the `tenant` column; the public
 * API never echoes tenancy back to callers.
 */
function stripTenant<T>(row: T): T {
  if (row === null || row === undefined || typeof row !== 'object') return row;
  const { tenant: _tenant, ...rest } = row as Record<string, unknown>;
  return rest as T;
}

function stripTenantAll<T>(rows: T[]): T[] {
  return rows.map(stripTenant);
}

function stripSequenceDetail(detail: SequenceDetail): SequenceDetail {
  return {
    sequence: stripTenant(detail.sequence),
    steps: stripTenantAll(detail.steps),
    stepStats: detail.stepStats,
    enrollments: stripTenantAll(detail.enrollments),
  };
}

function throwMarketingApiError(error: unknown): never {
  if (!(error instanceof Error)) throw error;

  if (
    [
      'Campaign not found',
      'Content piece not found',
      'Channel not found',
      'Capture form not found',
      'Sequence not found',
      'Post target not found',
    ].includes(error.message)
  ) {
    throw new NotFoundError(error.message);
  }

  if (
    error.message === 'Step order must be contiguous starting at 1' ||
    error.message === 'One or more channels are missing or inactive' ||
    error.message === 'Contact has no email address'
  ) {
    throw new ValidationError(error.message);
  }

  if (
    error.message === 'Content is used by scheduled posts and cannot be deleted' ||
    error.message === 'Post cannot be rescheduled in its current state' ||
    error.message === 'Target cannot be skipped in its current state' ||
    error.message === 'Only active sequences accept enrollments' ||
    error.message === 'Sequence has no steps' ||
    error.message === 'Contact is already enrolled in this sequence' ||
    error.message === 'Contact is suppressed from marketing email' ||
    error.message.startsWith('Target cannot be published from state')
  ) {
    throw new ConflictError(error.message);
  }

  throw error;
}

export class MarketingService extends BaseService<any> {
  constructor() {
    super({
      tableName: 'marketing_campaigns',
      primaryKey: 'campaign_id',
      tenantColumn: 'tenant',
      auditFields: {
        createdBy: 'created_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      searchableFields: ['name'],
      defaultSort: 'created_at',
      defaultOrder: 'desc',
    });
  }

  // -------------------------------------------------------------------------
  // Campaigns
  // -------------------------------------------------------------------------

  async listCampaigns(context: ServiceContext): Promise<IMarketingCampaign[]> {
    const knex = await this.getDbForContext(context);
    const rows = await listCampaignsInternal(knex, context.tenant);
    return stripTenantAll(rows);
  }

  async getCampaign(id: string, context: ServiceContext): Promise<IMarketingCampaign | null> {
    const knex = await this.getDbForContext(context);
    const row = await getCampaignInternal(knex, context.tenant, id);
    return row ? stripTenant(row) : null;
  }

  async createCampaign(data: CreateCampaignApi, context: ServiceContext): Promise<IMarketingCampaign> {
    const knex = await this.getDbForContext(context);
    const row = await createCampaignInternal(knex, context.tenant, data, context.userId);
    return stripTenant(row);
  }

  async updateCampaign(id: string, data: UpdateCampaignApi, context: ServiceContext): Promise<IMarketingCampaign> {
    const knex = await this.getDbForContext(context);
    const row = await updateCampaignInternal(knex, context.tenant, id, data)
      .catch(throwMarketingApiError);
    return stripTenant(row);
  }

  async getCampaignFunnel(id: string, context: ServiceContext): Promise<IMarketingCampaignFunnel> {
    const knex = await this.getDbForContext(context);
    const campaign = await getCampaignInternal(knex, context.tenant, id);
    if (!campaign) throw new NotFoundError('Campaign not found');
    return getCampaignFunnelInternal(knex, context.tenant, id);
  }

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  async listContent(context: ServiceContext, campaignId?: string): Promise<IMarketingContent[]> {
    const knex = await this.getDbForContext(context);
    const rows = await listContentInternal(knex, context.tenant, campaignId);
    return stripTenantAll(rows);
  }

  async getContent(id: string, context: ServiceContext): Promise<IMarketingContent | null> {
    const knex = await this.getDbForContext(context);
    const row = await getContentInternal(knex, context.tenant, id);
    return row ? stripTenant(row) : null;
  }

  async createContent(data: CreateContentApi, context: ServiceContext): Promise<IMarketingContent> {
    const knex = await this.getDbForContext(context);
    const row = await createContentInternal(knex, context.tenant, data, context.userId);
    return stripTenant(row);
  }

  async updateContent(id: string, data: UpdateContentApi, context: ServiceContext): Promise<IMarketingContent> {
    const knex = await this.getDbForContext(context);
    const row = await updateContentInternal(knex, context.tenant, id, data)
      .catch(throwMarketingApiError);
    return stripTenant(row);
  }

  async deleteContent(id: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const existing = await getContentInternal(knex, context.tenant, id);
    if (!existing) throw new NotFoundError('Content piece not found');
    await deleteContentInternal(knex, context.tenant, id).catch(throwMarketingApiError);
  }

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  async listChannels(context: ServiceContext, activeOnly = false): Promise<IMarketingChannel[]> {
    const knex = await this.getDbForContext(context);
    const rows = await listChannelsInternal(knex, context.tenant, activeOnly);
    return stripTenantAll(rows);
  }

  async createChannel(data: CreateChannelApi, context: ServiceContext): Promise<IMarketingChannel> {
    const knex = await this.getDbForContext(context);
    const row = await createChannelInternal(knex, context.tenant, data, context.userId);
    return stripTenant(row);
  }

  async updateChannel(id: string, data: UpdateChannelApi, context: ServiceContext): Promise<IMarketingChannel> {
    const knex = await this.getDbForContext(context);
    const row = await updateChannelInternal(knex, context.tenant, id, data)
      .catch(throwMarketingApiError);
    return stripTenant(row);
  }

  // -------------------------------------------------------------------------
  // Capture forms
  // -------------------------------------------------------------------------

  async listForms(context: ServiceContext): Promise<IMarketingCaptureForm[]> {
    const knex = await this.getDbForContext(context);
    const rows = await listFormsInternal(knex, context.tenant);
    return stripTenantAll(rows);
  }

  async createForm(data: CreateFormApi, context: ServiceContext): Promise<IMarketingCaptureForm> {
    const knex = await this.getDbForContext(context);
    const row = await createFormInternal(knex, context.tenant, data, context.userId);
    return stripTenant(row);
  }

  async updateForm(id: string, data: UpdateFormApi, context: ServiceContext): Promise<IMarketingCaptureForm> {
    const knex = await this.getDbForContext(context);
    const row = await updateFormInternal(knex, context.tenant, id, data)
      .catch(throwMarketingApiError);
    return stripTenant(row);
  }

  // -------------------------------------------------------------------------
  // Social posts / publish loop
  // -------------------------------------------------------------------------

  async getPostQueue(filters: PostQueueQuery, context: ServiceContext): Promise<ISocialPostQueueItem[]> {
    const knex = await this.getDbForContext(context);
    const rows = await getQueueInternal(knex, context.tenant, filters);
    return stripTenantAll(rows);
  }

  async getAwaitingPublish(context: ServiceContext): Promise<ISocialPostQueueItem[]> {
    const knex = await this.getDbForContext(context);
    const rows = await getAwaitingPublishInternal(knex, context.tenant);
    return stripTenantAll(rows);
  }

  async createPost(data: CreatePostApi, context: ServiceContext): Promise<ISocialPost> {
    const knex = await this.getDbForContext(context);
    const row = await createPostInternal(knex, context.tenant, {
      ...data,
      created_by: context.userId,
    }).catch(throwMarketingApiError);
    return stripTenant(row);
  }

  async reschedulePost(id: string, scheduledAt: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const post = await tenantDb(knex, context.tenant).table('social_posts')
      .where({ tenant: context.tenant, post_id: id })
      .first('post_id');
    if (!post) throw new NotFoundError('Social post not found');
    await reschedulePostInternal(knex, context.tenant, id, scheduledAt)
      .catch(throwMarketingApiError);
  }

  async markTargetPublished(
    targetId: string,
    permalink: string | null | undefined,
    context: ServiceContext,
  ): Promise<ISocialPostTarget> {
    const knex = await this.getDbForContext(context);

    // publishedBy: the API caller when resolvable, else the post's creator.
    let publishedBy = context.userId;
    if (!publishedBy) {
      const row = await tenantDb(knex, context.tenant).table('social_post_targets as t')
        .join('social_posts as p', function joinPost() {
          this.on('p.tenant', '=', 't.tenant').andOn('p.post_id', '=', 't.post_id');
        })
        .where({ 't.tenant': context.tenant, 't.target_id': targetId })
        .first('p.created_by');
      if (!row) throw new NotFoundError('Post target not found');
      publishedBy = row.created_by;
    }

    const row = await markTargetPublishedInternal(knex, context.tenant, targetId, {
      permalink: permalink ?? null,
      publishedBy,
      publishedVia: 'api',
    }).catch(throwMarketingApiError);
    return stripTenant(row);
  }

  async skipTarget(targetId: string, context: ServiceContext): Promise<ISocialPostTarget> {
    const knex = await this.getDbForContext(context);
    const existing = await tenantDb(knex, context.tenant).table('social_post_targets')
      .where({ tenant: context.tenant, target_id: targetId })
      .first('target_id');
    if (!existing) throw new NotFoundError('Post target not found');
    const row = await skipTargetInternal(knex, context.tenant, targetId)
      .catch(throwMarketingApiError);
    return stripTenant(row);
  }

  // -------------------------------------------------------------------------
  // Sequences
  // -------------------------------------------------------------------------

  async listSequences(context: ServiceContext): Promise<IMarketingSequence[]> {
    const knex = await this.getDbForContext(context);
    const rows = await listSequencesInternal(knex, context.tenant);
    return stripTenantAll(rows);
  }

  async getSequenceDetail(id: string, context: ServiceContext): Promise<SequenceDetail | null> {
    const knex = await this.getDbForContext(context);
    const detail = await getSequenceDetailInternal(knex, context.tenant, id);
    return detail ? stripSequenceDetail(detail) : null;
  }

  async createSequence(data: CreateSequenceApi, context: ServiceContext): Promise<IMarketingSequence> {
    const knex = await this.getDbForContext(context);
    const row = await createSequenceInternal(knex, context.tenant, data, context.userId)
      .catch(throwMarketingApiError);
    return stripTenant(row);
  }

  async updateSequence(id: string, data: UpdateSequenceApi, context: ServiceContext): Promise<IMarketingSequence> {
    const knex = await this.getDbForContext(context);
    const row = await updateSequenceInternal(knex, context.tenant, id, data)
      .catch(throwMarketingApiError);
    return stripTenant(row);
  }

  async enrollContact(
    sequenceId: string,
    contactId: string,
    context: ServiceContext,
  ): Promise<IMarketingSequenceEnrollment> {
    const knex = await this.getDbForContext(context);
    const row = await enrollContactInternal(knex, context.tenant, sequenceId, contactId, context.userId)
      .catch(throwMarketingApiError);
    return stripTenant(row);
  }

  async unenrollContact(enrollmentId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const existing = await tenantDb(knex, context.tenant).table('marketing_sequence_enrollments')
      .where({ tenant: context.tenant, enrollment_id: enrollmentId, state: 'active' })
      .first('enrollment_id');
    if (!existing) throw new NotFoundError('Sequence enrollment not found');
    await unenrollContactInternal(knex, context.tenant, enrollmentId)
      .catch(throwMarketingApiError);
  }
}
