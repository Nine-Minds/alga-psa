import { TenantEntity } from './index';
import type { ISO8601String } from '../lib/temporal';

// ---------------------------------------------------------------------------
// Marketing module (droppable: marketing tables reference core, never the
// reverse). Interactions are the engagement log; these types are the machine.
// ---------------------------------------------------------------------------

export type MarketingCampaignStatus = 'draft' | 'active' | 'completed' | 'archived';

export type SocialPostStatus =
  | 'draft'
  | 'scheduled'
  | 'awaiting-manual-publish'
  | 'published'
  | 'expired';

export type SocialPostTargetStatus =
  | 'scheduled'
  | 'awaiting-manual-publish'
  | 'published'
  | 'skipped'
  | 'expired';

export type MarketingSequenceStatus = 'draft' | 'active' | 'paused' | 'archived';

export type MarketingEnrollmentState = 'active' | 'completed' | 'stopped';

export type MarketingSuppressionReason = 'unsubscribe' | 'bounce' | 'complaint' | 'manual';

export type MarketingSuppressionSource = 'link' | 'reply' | 'import' | 'admin';

/** Global system interaction type_names (system_interaction_types) seeded once by 20260719103000. */
export type MarketingInteractionTypeName =
  | 'Marketing: Post Published'
  | 'Marketing: Email Sent'
  | 'Marketing: Email Opened'
  | 'Marketing: Email Clicked'
  | 'Marketing: Form Submitted';

export interface IMarketingCampaign extends TenantEntity {
  campaign_id: string;
  name: string;
  goal?: string | null;
  source_channel?: string | null;
  status: MarketingCampaignStatus;
  start_date?: string | null;
  end_date?: string | null;
  created_by: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IMarketingContent extends TenantEntity {
  content_id: string;
  campaign_id?: string | null;
  title: string;
  body_markdown: string;
  /** Per-platform override text keyed by platform label, e.g. { linkedin: "...", x: "..." }. */
  channel_variants: Record<string, string>;
  created_by: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

/** A named publishing destination. Never holds credentials — publishing is manual or MCP-delegated. */
export interface IMarketingChannel extends TenantEntity {
  channel_id: string;
  name: string;
  platform: string;
  handle_or_url?: string | null;
  is_active: boolean;
  created_by: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IMarketingCaptureForm extends TenantEntity {
  form_id: string;
  name: string;
  /** URL-safe public identifier: /api/v1/marketing/capture/{slug}. */
  slug: string;
  description?: string | null;
  campaign_id?: string | null;
  /** When true, submissions also create an inbound-lead opportunity suggestion. */
  creates_suggestion: boolean;
  is_active: boolean;
  created_by: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface ISocialPost extends TenantEntity {
  post_id: string;
  content_id: string;
  campaign_id?: string | null;
  /** Rollup of target states, maintained by the actions layer. */
  status: SocialPostStatus;
  scheduled_at?: ISO8601String | null;
  created_by: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface ISocialPostTarget extends TenantEntity {
  target_id: string;
  post_id: string;
  channel_id: string;
  status: SocialPostTargetStatus;
  permalink?: string | null;
  published_at?: ISO8601String | null;
  published_by?: string | null;
  /** 'ui' | 'api' | 'mcp' — provenance for the publish loop. */
  published_via?: string | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IMarketingSequence extends TenantEntity {
  sequence_id: string;
  name: string;
  description?: string | null;
  status: MarketingSequenceStatus;
  campaign_id?: string | null;
  created_by: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IMarketingSequenceStep extends TenantEntity {
  step_id: string;
  sequence_id: string;
  step_order: number;
  /** Minutes after the previous send (or enrollment, for step 1). 0 = immediate. */
  delay_minutes: number;
  subject: string;
  /** Markdown template with {{merge.fields}}. */
  body_template: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IMarketingSequenceEnrollment extends TenantEntity {
  enrollment_id: string;
  sequence_id: string;
  contact_id: string;
  /** 0 = nothing sent yet; equals step_order of the last sent step otherwise. */
  current_step_order: number;
  state: MarketingEnrollmentState;
  next_send_at?: ISO8601String | null;
  enrolled_by?: string | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

/** Per-contact marketing state; hangs off contacts without modifying them. */
export interface IMarketingContactState extends TenantEntity {
  contact_id: string;
  consent: boolean;
  source?: string | null;
  unsubscribed_at?: ISO8601String | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

/** Global suppression entry, keyed by lowercased email so it survives contact deletion/re-import. */
export interface IMarketingSuppression extends TenantEntity {
  suppression_id: string;
  email: string;
  contact_id?: string | null;
  reason: MarketingSuppressionReason;
  source: MarketingSuppressionSource;
  created_at: ISO8601String;
}

/** Join row linking an interaction (the log) to marketing entities (the machine). */
export interface IMarketingEngagement extends TenantEntity {
  engagement_id: string;
  interaction_id: string;
  campaign_id?: string | null;
  content_id?: string | null;
  post_id?: string | null;
  step_id?: string | null;
  created_at: ISO8601String;
}

// ---------------------------------------------------------------------------
// View models (derived, not tables)
// ---------------------------------------------------------------------------

/** A post target joined with everything the queue/calendar UI and publish loop need. */
export interface ISocialPostQueueItem extends ISocialPostTarget {
  post_status: SocialPostStatus;
  scheduled_at?: ISO8601String | null;
  content_title: string;
  content_body_markdown: string;
  channel_variants: Record<string, string>;
  channel_name: string;
  channel_platform: string;
  channel_handle_or_url?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  /** Rendered per-channel text (variant override or base body). */
  rendered_text: string;
}

/** Campaign funnel counts for the detail header. */
export interface IMarketingCampaignFunnel {
  posts_published: number;
  emails_sent: number;
  emails_opened: number;
  emails_clicked: number;
  forms_submitted: number;
  suggestions_created: number;
  suggestions_accepted: number;
}

/** Per-step stats for the journey cards. */
export interface IMarketingSequenceStepStats {
  step_id: string;
  step_order: number;
  sent: number;
  opened: number;
  clicked: number;
}

export interface IMarketingEnrollmentWithContact extends IMarketingSequenceEnrollment {
  contact_name: string;
  contact_email: string;
  step_count: number;
}
