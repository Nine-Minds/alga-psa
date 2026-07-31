import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import type { ZodTypeAny } from 'zod';
import {
  createCampaignApiSchema,
  updateCampaignApiSchema,
  createContentApiSchema,
  updateContentApiSchema,
  contentListQuerySchema,
  createChannelApiSchema,
  updateChannelApiSchema,
  createFormApiSchema,
  updateFormApiSchema,
  createPostApiSchema,
  reschedulePostApiSchema,
  markTargetPublishedApiSchema,
  postQueueQuerySchema,
  createSequenceApiSchema,
  updateSequenceApiSchema,
  enrollContactApiSchema,
} from '../../schemas/marketingSchemas';

export function registerMarketingV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Marketing v1';

  const CampaignIdParam = registry.registerSchema(
    'MarketingCampaignIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('Campaign UUID from marketing_campaigns.campaign_id.') }),
  );
  const ContentIdParam = registry.registerSchema(
    'MarketingContentIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('Content UUID from marketing_content.content_id.') }),
  );
  const ChannelIdParam = registry.registerSchema(
    'MarketingChannelIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('Channel UUID from marketing_channels.channel_id.') }),
  );
  const FormIdParam = registry.registerSchema(
    'MarketingFormIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('Capture form UUID from marketing_capture_forms.form_id.') }),
  );
  const PostIdParam = registry.registerSchema(
    'MarketingPostIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('Social post UUID from social_posts.post_id.') }),
  );
  const TargetIdParam = registry.registerSchema(
    'MarketingTargetIdParamV1',
    zOpenApi.object({ targetId: zOpenApi.string().uuid().describe('Post target UUID from social_post_targets.target_id.') }),
  );
  const SequenceIdParam = registry.registerSchema(
    'MarketingSequenceIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('Sequence UUID from marketing_sequences.sequence_id.') }),
  );
  const EnrollmentIdParam = registry.registerSchema(
    'MarketingEnrollmentIdParamV1',
    zOpenApi.object({ enrollmentId: zOpenApi.string().uuid().describe('Enrollment UUID from marketing_sequence_enrollments.enrollment_id.') }),
  );

  const ContentListQuery = registry.registerSchema('MarketingContentListQueryV1', contentListQuerySchema);
  const ChannelListQuery = registry.registerSchema(
    'MarketingChannelListQueryV1',
    zOpenApi.object({
      active_only: zOpenApi
        .enum(['true', 'false'])
        .optional()
        .describe('When "true", only active channels are returned. Omit for all channels.'),
    }),
  );
  const PostQueueQuery = registry.registerSchema('MarketingPostQueueQueryV1', postQueueQuerySchema);

  const CreateCampaignBody = registry.registerSchema('CreateMarketingCampaignBodyV1', createCampaignApiSchema);
  const UpdateCampaignBody = registry.registerSchema('UpdateMarketingCampaignBodyV1', updateCampaignApiSchema);
  const CreateContentBody = registry.registerSchema('CreateMarketingContentBodyV1', createContentApiSchema);
  const UpdateContentBody = registry.registerSchema('UpdateMarketingContentBodyV1', updateContentApiSchema);
  const CreateChannelBody = registry.registerSchema('CreateMarketingChannelBodyV1', createChannelApiSchema);
  const UpdateChannelBody = registry.registerSchema('UpdateMarketingChannelBodyV1', updateChannelApiSchema);
  const CreateFormBody = registry.registerSchema('CreateMarketingFormBodyV1', createFormApiSchema);
  const UpdateFormBody = registry.registerSchema('UpdateMarketingFormBodyV1', updateFormApiSchema);
  const CreatePostBody = registry.registerSchema('CreateMarketingPostBodyV1', createPostApiSchema);
  const ReschedulePostBody = registry.registerSchema('RescheduleMarketingPostBodyV1', reschedulePostApiSchema);
  const MarkPublishedBody = registry.registerSchema('MarkMarketingTargetPublishedBodyV1', markTargetPublishedApiSchema);
  const CreateSequenceBody = registry.registerSchema('CreateMarketingSequenceBodyV1', createSequenceApiSchema);
  const UpdateSequenceBody = registry.registerSchema('UpdateMarketingSequenceBodyV1', updateSequenceApiSchema);
  const EnrollBody = registry.registerSchema('EnrollMarketingContactBodyV1', enrollContactApiSchema);

  const ApiError = registry.registerSchema(
    'MarketingApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );
  const ApiSuccess = registry.registerSchema(
    'MarketingApiSuccessV1',
    zOpenApi.object({
      data: zOpenApi.record(zOpenApi.unknown()),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );
  const ApiArraySuccess = registry.registerSchema(
    'MarketingApiArraySuccessV1',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  type Def = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    summary: string;
    description: string;
    body?: ZodTypeAny;
    query?: ZodTypeAny;
    params?: ZodTypeAny;
    successStatus?: 200 | 201 | 204;
    arrayResponse?: boolean;
  };

  const defs: Def[] = [
    {
      method: 'get', path: '/api/v1/marketing/campaigns', summary: 'List marketing campaigns',
      description: 'Lists all marketing campaigns for the tenant, newest first. Marketing campaigns group content, social posts, capture forms, and nurture sequences for attribution and funnel reporting.',
      arrayResponse: true,
    },
    {
      method: 'post', path: '/api/v1/marketing/campaigns', summary: 'Create marketing campaign',
      description: 'Creates a marketing campaign. Campaigns anchor attribution: social posts, capture form submissions, and nurture sequence engagements roll up into the campaign funnel.',
      body: CreateCampaignBody, successStatus: 201,
    },
    {
      method: 'get', path: '/api/v1/marketing/campaigns/{id}', summary: 'Get marketing campaign',
      description: 'Gets one marketing campaign by UUID.',
      params: CampaignIdParam,
    },
    {
      method: 'put', path: '/api/v1/marketing/campaigns/{id}', summary: 'Update marketing campaign',
      description: 'Updates editable marketing campaign fields (name, goal, source channel, status, start/end dates).',
      body: UpdateCampaignBody, params: CampaignIdParam,
    },
    {
      method: 'get', path: '/api/v1/marketing/campaigns/{id}/funnel', summary: 'Get campaign funnel',
      description: 'Returns the marketing campaign funnel: posts published, emails sent/opened/clicked, capture forms submitted, and inbound-lead opportunity suggestions created/accepted for the campaign.',
      params: CampaignIdParam,
    },
    {
      method: 'get', path: '/api/v1/marketing/content', summary: 'List marketing content',
      description: 'Lists marketing content pieces (title, markdown body, per-channel variant text). Optionally filter by campaign_id. Content is the source material scheduled to channels as social posts.',
      query: ContentListQuery, arrayResponse: true,
    },
    {
      method: 'post', path: '/api/v1/marketing/content', summary: 'Create marketing content',
      description: 'Creates a marketing content piece with a markdown body and optional per-platform channel_variants overrides used when rendering social posts per channel.',
      body: CreateContentBody, successStatus: 201,
    },
    {
      method: 'get', path: '/api/v1/marketing/content/{id}', summary: 'Get marketing content',
      description: 'Gets one marketing content piece by UUID, including its channel_variants.',
      params: ContentIdParam,
    },
    {
      method: 'put', path: '/api/v1/marketing/content/{id}', summary: 'Update marketing content',
      description: 'Updates a marketing content piece (title, body_markdown, channel_variants, campaign assignment).',
      body: UpdateContentBody, params: ContentIdParam,
    },
    {
      method: 'delete', path: '/api/v1/marketing/content/{id}', summary: 'Delete marketing content',
      description: 'Deletes a marketing content piece. Content referenced by social posts cannot be deleted (returns 409).',
      params: ContentIdParam, successStatus: 204,
    },
    {
      method: 'get', path: '/api/v1/marketing/channels', summary: 'List marketing channels',
      description: 'Lists marketing channels — named publishing destinations (e.g. LinkedIn, X) that social posts target. Channels never hold credentials; publishing is manual or agent-delegated via the publish loop.',
      query: ChannelListQuery, arrayResponse: true,
    },
    {
      method: 'post', path: '/api/v1/marketing/channels', summary: 'Create marketing channel',
      description: 'Creates a marketing channel (name, platform, optional handle_or_url) that social posts can be scheduled to.',
      body: CreateChannelBody, successStatus: 201,
    },
    {
      method: 'put', path: '/api/v1/marketing/channels/{id}', summary: 'Update marketing channel',
      description: 'Updates a marketing channel, including activating/deactivating it. Inactive channels reject new social posts.',
      body: UpdateChannelBody, params: ChannelIdParam,
    },
    {
      method: 'get', path: '/api/v1/marketing/forms', summary: 'List capture forms',
      description: 'Lists marketing capture forms (lead-capture definitions with public slugs). Each active form accepts public submissions at its capture URL and can create inbound-lead opportunity suggestions.',
      arrayResponse: true,
    },
    {
      method: 'post', path: '/api/v1/marketing/forms', summary: 'Create capture form',
      description: 'Creates a marketing capture form with a URL-safe slug. The public submission endpoint is /api/marketing/capture/{tenant}/{slug}.',
      body: CreateFormBody, successStatus: 201,
    },
    {
      method: 'put', path: '/api/v1/marketing/forms/{id}', summary: 'Update capture form',
      description: 'Updates a marketing capture form (name, description, campaign, creates_suggestion, is_active). The slug is immutable.',
      body: UpdateFormBody, params: FormIdParam,
    },
    {
      method: 'get', path: '/api/v1/marketing/posts/queue', summary: 'List social post queue',
      description: 'Lists social post targets joined with rendered per-channel text, content, channel, and campaign — the marketing publish queue. Filter by target status, channel_id, campaign_id, or scheduled date range. Use status=awaiting-manual-publish for the publish loop reading list.',
      query: PostQueueQuery, arrayResponse: true,
    },
    {
      method: 'get', path: '/api/v1/marketing/posts/awaiting-publish', summary: 'List posts awaiting manual publish',
      description: 'The agent publish loop reading list: every social post target in awaiting-manual-publish state, with rendered_text ready to post on the target channel platform. An agent reads this list, publishes each item on the platform, then calls the publish endpoint with the resulting permalink.',
      arrayResponse: true,
    },
    {
      method: 'post', path: '/api/v1/marketing/posts', summary: 'Create social post',
      description: 'Creates a social post from a marketing content piece, fanning out one target per channel_id. When scheduled_at is set the post enters the publish loop: at due time its targets flip to awaiting-manual-publish.',
      body: CreatePostBody, successStatus: 201,
    },
    {
      method: 'post', path: '/api/v1/marketing/posts/{id}/reschedule', summary: 'Reschedule social post',
      description: 'Reschedules a draft or scheduled social post to a new scheduled_at. Posts already in the publish loop (awaiting-manual-publish/published/expired) cannot be rescheduled.',
      body: ReschedulePostBody, params: PostIdParam,
    },
    {
      method: 'post', path: '/api/v1/marketing/posts/targets/{targetId}/publish', summary: 'Mark post target published',
      description: 'Completes one publish loop step: marks a social post target published, recording the permalink and published_via=api provenance. Idempotent — republishing an already-published target returns it unchanged. Read GET /api/v1/marketing/posts/awaiting-publish first to find targets awaiting manual publish.',
      body: MarkPublishedBody, params: TargetIdParam,
    },
    {
      method: 'post', path: '/api/v1/marketing/posts/targets/{targetId}/skip', summary: 'Skip post target',
      description: 'Skips a scheduled or awaiting-manual-publish social post target, removing it from the publish loop without publishing.',
      params: TargetIdParam,
    },
    {
      method: 'get', path: '/api/v1/marketing/sequences', summary: 'List nurture sequences',
      description: 'Lists marketing nurture sequences — ordered, timed email steps sent to enrolled contacts.',
      arrayResponse: true,
    },
    {
      method: 'post', path: '/api/v1/marketing/sequences', summary: 'Create nurture sequence',
      description: 'Creates a marketing nurture sequence with steps. Step order must be contiguous starting at 1; delay_minutes is the wait after the previous send (or enrollment for step 1). Subjects and body templates support {{merge.fields}}.',
      body: CreateSequenceBody, successStatus: 201,
    },
    {
      method: 'get', path: '/api/v1/marketing/sequences/{id}', summary: 'Get nurture sequence detail',
      description: 'Gets one marketing nurture sequence with its steps, per-step send/open/click stats, and current enrollments.',
      params: SequenceIdParam,
    },
    {
      method: 'put', path: '/api/v1/marketing/sequences/{id}', summary: 'Update nurture sequence',
      description: 'Updates a marketing nurture sequence. Supplying steps replaces the full step list (order must be contiguous from 1). Set status to active to accept enrollments.',
      body: UpdateSequenceBody, params: SequenceIdParam,
    },
    {
      method: 'post', path: '/api/v1/marketing/sequences/{id}/enroll', summary: 'Enroll contact in sequence',
      description: 'Enrolls a contact in an active marketing nurture sequence. The contact must have an email address and not be suppressed; duplicate active enrollments are rejected.',
      body: EnrollBody, params: SequenceIdParam, successStatus: 201,
    },
    {
      method: 'post', path: '/api/v1/marketing/sequences/enrollments/{enrollmentId}/unenroll', summary: 'Unenroll contact',
      description: 'Stops an active nurture sequence enrollment; no further sequence emails are sent to the contact for that enrollment.',
      params: EnrollmentIdParam, successStatus: 204,
    },
  ];

  for (const def of defs) {
    const status = def.successStatus ?? 200;
    const responses: Record<number, any> = {
      [status]: status === 204
        ? { description: 'Operation succeeded with no response body.', emptyBody: true }
        : {
            description: 'Operation succeeded.',
            schema: def.arrayResponse ? ApiArraySuccess : ApiSuccess,
          },
      400: { description: 'Validation or request parsing failure.', schema: ApiError },
      401: { description: 'API key missing or invalid.', schema: ApiError },
      403: { description: 'RBAC denied for the marketing resource action.', schema: ApiError },
      404: { description: 'Marketing resource not found, or the marketing-module feature flag is off for this tenant.', schema: ApiError },
      409: { description: 'Marketing resource state conflicts with the requested operation.', schema: ApiError },
      500: { description: 'Unexpected controller or service failure.', schema: ApiError },
    };

    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: {
        ...(def.params ? { params: def.params } : {}),
        ...(def.query ? { query: def.query } : {}),
        ...(def.body ? { body: { schema: def.body } } : {}),
      },
      responses,
      extensions: {
        'x-tenant-scoped': true,
        'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate()',
        'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
        'x-rbac-resource': 'marketing',
        'x-feature-flag': 'marketing-module (404 when disabled for the tenant)',
      },
      edition: 'both',
    });
  }
}
