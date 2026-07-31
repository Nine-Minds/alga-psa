import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isFeatureFlagEnabled } from '@alga-psa/core';
import { MARKETING_MODULE_FLAG } from '@alga-psa/marketing/lib';
import { ApiBaseController, type AuthenticatedApiRequest } from './ApiBaseController';
import { MarketingService } from '../services/MarketingService';
import {
  createCampaignApiSchema,
  updateCampaignApiSchema,
  createContentApiSchema,
  updateContentApiSchema,
  contentListQuerySchema,
  createChannelApiSchema,
  updateChannelApiSchema,
  channelListQuerySchema,
  createFormApiSchema,
  updateFormApiSchema,
  createPostApiSchema,
  reschedulePostApiSchema,
  markTargetPublishedApiSchema,
  postQueueQuerySchema,
  createSequenceApiSchema,
  updateSequenceApiSchema,
  enrollContactApiSchema,
} from '../schemas/marketingSchemas';
import { runWithTenant } from '../../db';
import {
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  handleApiError,
} from '../middleware/apiMiddleware';

const uuidSchema = z.string().uuid();

type MarketingAction = 'read' | 'manage';

export class ApiMarketingController extends ApiBaseController {
  private marketingService: MarketingService;

  constructor() {
    const marketingService = new MarketingService();
    super(marketingService, {
      resource: 'marketing',
      permissions: {
        create: 'manage',
        read: 'read',
        update: 'manage',
        delete: 'manage',
        list: 'read',
      },
    });
    this.marketingService = marketingService;
  }

  /**
   * Feature-flag gate: the marketing module is invisible (404, not 403) to
   * tenants without the `marketing-module` flag — same not-found semantics as
   * requesting an uninstalled module's resources.
   */
  private async assertMarketingEnabled(req: AuthenticatedApiRequest): Promise<void> {
    const enabled = await isFeatureFlagEnabled(MARKETING_MODULE_FLAG, {
      tenantId: req.context.tenant,
      userId: req.context.userId,
    });
    if (!enabled) {
      throw new NotFoundError('Marketing module is not enabled for this tenant');
    }
  }

  /**
   * The opportunities handler pipeline, factored once:
   * authenticate -> tenant context -> feature flag -> RBAC -> handler.
   */
  private handle(
    action: MarketingAction,
    handler: (apiRequest: AuthenticatedApiRequest) => Promise<NextResponse>,
  ) {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.assertMarketingEnabled(apiRequest);
          await this.checkPermission(apiRequest, action);
          return handler(apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  private async extractNestedUuid(req: NextRequest, key: string): Promise<string> {
    const params = await (req as any).params;
    const parsed = uuidSchema.safeParse(params?.[key]);
    if (!parsed.success) throw new ValidationError(`Invalid ${key} format`);
    return parsed.data;
  }

  // -------------------------------------------------------------------------
  // Campaigns
  // -------------------------------------------------------------------------

  listCampaigns() {
    return this.handle('read', async (apiRequest) => {
      const campaigns = await this.marketingService.listCampaigns(apiRequest.context);
      return createSuccessResponse(campaigns);
    });
  }

  createCampaign() {
    return this.handle('manage', async (apiRequest) => {
      const data = await this.validateData(apiRequest, createCampaignApiSchema);
      const campaign = await this.marketingService.createCampaign(data, apiRequest.context);
      return createSuccessResponse(campaign, 201);
    });
  }

  getCampaign() {
    return this.handle('read', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const campaign = await this.marketingService.getCampaign(id, apiRequest.context);
      if (!campaign) throw new NotFoundError('Campaign not found');
      return createSuccessResponse(campaign);
    });
  }

  updateCampaign() {
    return this.handle('manage', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const data = await this.validateData(apiRequest, updateCampaignApiSchema);
      const campaign = await this.marketingService.updateCampaign(id, data, apiRequest.context);
      return createSuccessResponse(campaign);
    });
  }

  getCampaignFunnel() {
    return this.handle('read', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const funnel = await this.marketingService.getCampaignFunnel(id, apiRequest.context);
      return createSuccessResponse(funnel);
    });
  }

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  listContent() {
    return this.handle('read', async (apiRequest) => {
      const query = this.validateQuery(apiRequest, contentListQuerySchema);
      const content = await this.marketingService.listContent(apiRequest.context, query.campaign_id);
      return createSuccessResponse(content);
    });
  }

  createContent() {
    return this.handle('manage', async (apiRequest) => {
      const data = await this.validateData(apiRequest, createContentApiSchema);
      const content = await this.marketingService.createContent(data, apiRequest.context);
      return createSuccessResponse(content, 201);
    });
  }

  getContent() {
    return this.handle('read', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const content = await this.marketingService.getContent(id, apiRequest.context);
      if (!content) throw new NotFoundError('Content piece not found');
      return createSuccessResponse(content);
    });
  }

  updateContent() {
    return this.handle('manage', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const data = await this.validateData(apiRequest, updateContentApiSchema);
      const content = await this.marketingService.updateContent(id, data, apiRequest.context);
      return createSuccessResponse(content);
    });
  }

  deleteContent() {
    return this.handle('manage', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      await this.marketingService.deleteContent(id, apiRequest.context);
      return new NextResponse(null, { status: 204 });
    });
  }

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  listChannels() {
    return this.handle('read', async (apiRequest) => {
      const query = this.validateQuery(apiRequest, channelListQuerySchema);
      const channels = await this.marketingService.listChannels(apiRequest.context, query.active_only ?? false);
      return createSuccessResponse(channels);
    });
  }

  createChannel() {
    return this.handle('manage', async (apiRequest) => {
      const data = await this.validateData(apiRequest, createChannelApiSchema);
      const channel = await this.marketingService.createChannel(data, apiRequest.context);
      return createSuccessResponse(channel, 201);
    });
  }

  updateChannel() {
    return this.handle('manage', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const data = await this.validateData(apiRequest, updateChannelApiSchema);
      const channel = await this.marketingService.updateChannel(id, data, apiRequest.context);
      return createSuccessResponse(channel);
    });
  }

  // -------------------------------------------------------------------------
  // Capture forms
  // -------------------------------------------------------------------------

  listForms() {
    return this.handle('read', async (apiRequest) => {
      const forms = await this.marketingService.listForms(apiRequest.context);
      return createSuccessResponse(forms);
    });
  }

  createForm() {
    return this.handle('manage', async (apiRequest) => {
      const data = await this.validateData(apiRequest, createFormApiSchema);
      const form = await this.marketingService.createForm(data, apiRequest.context);
      return createSuccessResponse(form, 201);
    });
  }

  updateForm() {
    return this.handle('manage', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const data = await this.validateData(apiRequest, updateFormApiSchema);
      const form = await this.marketingService.updateForm(id, data, apiRequest.context);
      return createSuccessResponse(form);
    });
  }

  // -------------------------------------------------------------------------
  // Social posts / agent publish loop
  // -------------------------------------------------------------------------

  getPostQueue() {
    return this.handle('read', async (apiRequest) => {
      const query = this.validateQuery(apiRequest, postQueueQuerySchema);
      const queue = await this.marketingService.getPostQueue(query, apiRequest.context);
      return createSuccessResponse(queue);
    });
  }

  getAwaitingPublish() {
    return this.handle('read', async (apiRequest) => {
      const queue = await this.marketingService.getAwaitingPublish(apiRequest.context);
      return createSuccessResponse(queue);
    });
  }

  createPost() {
    return this.handle('manage', async (apiRequest) => {
      const data = await this.validateData(apiRequest, createPostApiSchema);
      const post = await this.marketingService.createPost(data, apiRequest.context);
      return createSuccessResponse(post, 201);
    });
  }

  reschedulePost() {
    return this.handle('manage', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const data = await this.validateData(apiRequest, reschedulePostApiSchema);
      await this.marketingService.reschedulePost(id, data.scheduled_at, apiRequest.context);
      return createSuccessResponse({ post_id: id, scheduled_at: data.scheduled_at, status: 'scheduled' });
    });
  }

  publishTarget() {
    return this.handle('manage', async (apiRequest) => {
      const targetId = await this.extractNestedUuid(apiRequest, 'targetId');
      const data = await this.validateData(apiRequest, markTargetPublishedApiSchema);
      const target = await this.marketingService.markTargetPublished(targetId, data.permalink, apiRequest.context);
      return createSuccessResponse(target);
    });
  }

  skipTarget() {
    return this.handle('manage', async (apiRequest) => {
      const targetId = await this.extractNestedUuid(apiRequest, 'targetId');
      const target = await this.marketingService.skipTarget(targetId, apiRequest.context);
      return createSuccessResponse(target);
    });
  }

  // -------------------------------------------------------------------------
  // Nurture sequences
  // -------------------------------------------------------------------------

  listSequences() {
    return this.handle('read', async (apiRequest) => {
      const sequences = await this.marketingService.listSequences(apiRequest.context);
      return createSuccessResponse(sequences);
    });
  }

  createSequence() {
    return this.handle('manage', async (apiRequest) => {
      const data = await this.validateData(apiRequest, createSequenceApiSchema);
      const sequence = await this.marketingService.createSequence(data, apiRequest.context);
      return createSuccessResponse(sequence, 201);
    });
  }

  getSequence() {
    return this.handle('read', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const detail = await this.marketingService.getSequenceDetail(id, apiRequest.context);
      if (!detail) throw new NotFoundError('Sequence not found');
      return createSuccessResponse(detail);
    });
  }

  updateSequence() {
    return this.handle('manage', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const data = await this.validateData(apiRequest, updateSequenceApiSchema);
      const sequence = await this.marketingService.updateSequence(id, data, apiRequest.context);
      return createSuccessResponse(sequence);
    });
  }

  enrollContact() {
    return this.handle('manage', async (apiRequest) => {
      const id = await this.extractIdFromPath(apiRequest);
      const data = await this.validateData(apiRequest, enrollContactApiSchema);
      const enrollment = await this.marketingService.enrollContact(id, data.contact_id, apiRequest.context);
      return createSuccessResponse(enrollment, 201);
    });
  }

  unenrollContact() {
    return this.handle('manage', async (apiRequest) => {
      const enrollmentId = await this.extractNestedUuid(apiRequest, 'enrollmentId');
      await this.marketingService.unenrollContact(enrollmentId, apiRequest.context);
      return new NextResponse(null, { status: 204 });
    });
  }
}
