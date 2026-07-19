import { z } from 'zod';

export const marketingCampaignStatusSchema = z.enum(['draft', 'active', 'completed', 'archived']);
export const socialPostStatusSchema = z.enum(['draft', 'scheduled', 'awaiting-manual-publish', 'published', 'expired']);
export const socialPostTargetStatusSchema = z.enum(['scheduled', 'awaiting-manual-publish', 'published', 'skipped', 'expired']);
export const marketingSequenceStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  goal: z.string().trim().max(2000).optional().nullable(),
  source_channel: z.string().trim().max(100).optional().nullable(),
  status: marketingCampaignStatusSchema.optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
export const campaignUpdateSchema = campaignInputSchema.partial();

export const contentInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body_markdown: z.string().max(50000).default(''),
  channel_variants: z.record(z.string().max(10000)).default({}),
  campaign_id: z.string().uuid().optional().nullable(),
});
export const contentUpdateSchema = contentInputSchema.partial();

export const channelInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  platform: z.string().trim().min(1).max(100),
  handle_or_url: z.string().trim().max(500).optional().nullable(),
  is_active: z.boolean().optional(),
});
export const channelUpdateSchema = channelInputSchema.partial();

const slugRegex = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;
export const captureFormInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(slugRegex, 'slug must be lowercase letters, digits, and dashes'),
  description: z.string().trim().max(2000).optional().nullable(),
  campaign_id: z.string().uuid().optional().nullable(),
  creates_suggestion: z.boolean().optional(),
  is_active: z.boolean().optional(),
});
export const captureFormUpdateSchema = captureFormInputSchema.partial().omit({ slug: true });

export const postCreateSchema = z.object({
  content_id: z.string().uuid(),
  campaign_id: z.string().uuid().optional().nullable(),
  channel_ids: z.array(z.string().uuid()).min(1),
  scheduled_at: z.string().datetime({ offset: true }).optional().nullable(),
});

export const postRescheduleSchema = z.object({
  scheduled_at: z.string().datetime({ offset: true }),
});

export const markPublishedSchema = z.object({
  // http(s) only: permalinks are rendered as hrefs, so a javascript: URL
  // here would be stored XSS.
  permalink: z.string().trim().url().max(1000)
    .refine((value) => /^https?:\/\//i.test(value), 'Permalink must be an http(s) URL')
    .optional()
    .nullable(),
});

export const queueFiltersSchema = z.object({
  status: socialPostTargetStatusSchema.optional(),
  channel_id: z.string().uuid().optional(),
  campaign_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

export const sequenceStepInputSchema = z.object({
  step_order: z.number().int().min(1),
  delay_minutes: z.number().int().min(0).max(60 * 24 * 365),
  subject: z.string().trim().min(1).max(300),
  body_template: z.string().max(50000).default(''),
});

export const sequenceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  status: marketingSequenceStatusSchema.optional(),
  campaign_id: z.string().uuid().optional().nullable(),
  steps: z.array(sequenceStepInputSchema).max(50).default([]),
});
export const sequenceUpdateSchema = sequenceInputSchema.partial();

export const enrollContactSchema = z.object({
  contact_id: z.string().uuid(),
});

/** Public capture payload — treat as hostile; endpoint layer rate-limits. */
export const captureSubmissionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  company: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().max(5000).optional().nullable(),
  // Honeypot: must be empty. Bots that fill hidden fields are dropped silently.
  website: z.string().max(0).optional(),
});

export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type ContentInput = z.infer<typeof contentInputSchema>;
export type ChannelInput = z.infer<typeof channelInputSchema>;
export type CaptureFormInput = z.infer<typeof captureFormInputSchema>;
export type PostCreateInput = z.infer<typeof postCreateSchema>;
export type QueueFilters = z.infer<typeof queueFiltersSchema>;
export type SequenceInput = z.infer<typeof sequenceInputSchema>;
export type CaptureSubmission = z.infer<typeof captureSubmissionSchema>;
