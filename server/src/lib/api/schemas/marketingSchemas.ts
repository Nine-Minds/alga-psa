import { z } from 'zod';
import {
  campaignInputSchema,
  campaignUpdateSchema,
  contentInputSchema,
  contentUpdateSchema,
  channelInputSchema,
  channelUpdateSchema,
  captureFormInputSchema,
  captureFormUpdateSchema,
  postCreateSchema,
  postRescheduleSchema,
  markPublishedSchema,
  sequenceInputSchema,
  sequenceUpdateSchema,
  enrollContactSchema,
  socialPostTargetStatusSchema,
} from '@alga-psa/marketing/schemas';

export const createCampaignApiSchema = campaignInputSchema;
export const updateCampaignApiSchema = campaignUpdateSchema;

export const createContentApiSchema = contentInputSchema;
export const updateContentApiSchema = contentUpdateSchema;

export const createChannelApiSchema = channelInputSchema;
export const updateChannelApiSchema = channelUpdateSchema;

export const createFormApiSchema = captureFormInputSchema;
export const updateFormApiSchema = captureFormUpdateSchema;

export const createPostApiSchema = postCreateSchema;
export const reschedulePostApiSchema = postRescheduleSchema;
export const markTargetPublishedApiSchema = markPublishedSchema;

export const createSequenceApiSchema = sequenceInputSchema;
export const updateSequenceApiSchema = sequenceUpdateSchema;
export const enrollContactApiSchema = enrollContactSchema;

export const contentListQuerySchema = z.object({
  campaign_id: z.string().uuid().optional(),
});

export const channelListQuerySchema = z.object({
  active_only: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

export const postQueueQuerySchema = z.object({
  status: socialPostTargetStatusSchema.optional(),
  channel_id: z.string().uuid().optional(),
  campaign_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

export type CreateCampaignApi = z.infer<typeof createCampaignApiSchema>;
export type UpdateCampaignApi = z.infer<typeof updateCampaignApiSchema>;
export type CreateContentApi = z.infer<typeof createContentApiSchema>;
export type UpdateContentApi = z.infer<typeof updateContentApiSchema>;
export type CreateChannelApi = z.infer<typeof createChannelApiSchema>;
export type UpdateChannelApi = z.infer<typeof updateChannelApiSchema>;
export type CreateFormApi = z.infer<typeof createFormApiSchema>;
export type UpdateFormApi = z.infer<typeof updateFormApiSchema>;
export type CreatePostApi = z.infer<typeof createPostApiSchema>;
export type ReschedulePostApi = z.infer<typeof reschedulePostApiSchema>;
export type MarkTargetPublishedApi = z.infer<typeof markTargetPublishedApiSchema>;
export type CreateSequenceApi = z.infer<typeof createSequenceApiSchema>;
export type UpdateSequenceApi = z.infer<typeof updateSequenceApiSchema>;
export type EnrollContactApi = z.infer<typeof enrollContactApiSchema>;
export type ContentListQuery = z.infer<typeof contentListQuerySchema>;
export type ChannelListQuery = z.infer<typeof channelListQuerySchema>;
export type PostQueueQuery = z.infer<typeof postQueueQuerySchema>;
