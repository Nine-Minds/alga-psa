import { TenantEntity } from './index';
import type { ISO8601String } from '../lib/temporal';

export type OpportunityStatus = 'open' | 'won' | 'lost';

export type OpportunityType = 'new_logo' | 'expansion' | 'renewal' | 'project';

/**
 * The opinionated stage ladder. Stage is DERIVED from evidence checkpoints
 * (persisted for querying, never set directly by users). Deals may skip
 * checkpoints — a renewal enters at 'proposed' when its quote goes out.
 */
export type OpportunityStage =
  | 'identified'
  | 'qualified'
  | 'assessment'
  | 'proposed'
  | 'verbal'
  | 'won'
  | 'lost';

/** Checkpoints that evidence can attest. 'qualified' is the one declared-type checkpoint. */
export type OpportunityCheckpoint = 'qualified' | 'assessment' | 'proposed' | 'verbal' | 'won';

/** Rep-declared confidence. Deliberately an enum — no percentages anywhere. Never alters derived stage. */
export type OpportunityConfidence = 'low' | 'medium' | 'high' | 'committed';

export type OpportunityEvidenceSource = 'system' | 'declared';

export type OpportunityEvidenceRefType =
  | 'quote'
  | 'contract'
  | 'project'
  | 'schedule_entry'
  | 'interaction';

export type OpportunityLossReason =
  | 'no_response'
  | 'chose_competitor'
  | 'price'
  | 'timing'
  | 'no_budget'
  | 'not_a_fit'
  | 'other';

export type OpportunityGeneratorKey = 'renewal' | 'tm_conversion' | 'whitespace' | 'asset_aging' | 'inbound-lead';

export type OpportunitySuggestionStatus = 'pending' | 'accepted' | 'dismissed' | 'snoozed';

export type OpportunityEscalationMode = 'solo' | 'team';

export interface IOpportunitySettings extends TenantEntity {
  nudge_days: number;
  interrupt_days: number;
  escalation_mode: OpportunityEscalationMode;
  renewal_lead_days: number;
  tm_threshold_cents: number;
  asset_age_years: number;
  assessment_service_ids: string[];
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IOpportunityVoiceProfile {
  sample_emails: string[];
  steering_instructions: string;
}

export interface IOpportunityFollowUpDraft {
  subject: string;
  body: string;
}

export interface IOpportunityHandoff {
  opportunity: Pick<
    IOpportunity,
    | 'opportunity_id'
    | 'opportunity_number'
    | 'title'
    | 'client_id'
    | 'owner_id'
    | 'stage'
    | 'status'
    | 'mrr_cents'
    | 'nrr_cents'
    | 'hardware_cents'
    | 'currency_code'
    | 'won_at'
  > & { client_name: string; owner_name: string };
  commitments: IOpportunityCommitment[];
  timeline: Array<{
    interaction_id: string;
    title: string;
    interaction_date: ISO8601String;
  }>;
}

/** Sales lifecycle for clients. Backfilled to 'active' for all pre-existing rows. */
export type ClientLifecycleStatus = 'prospect' | 'active' | 'former';

export interface IOpportunity extends TenantEntity {
  opportunity_id: string;
  /** Human-facing number, e.g. OPP-1042 (next_number entity 'OPPORTUNITY'). Shown instead of the UUID everywhere. */
  opportunity_number: string;
  client_id: string;
  contact_id?: string | null;
  title: string;
  opportunity_type: OpportunityType;
  /** Defaults to the client's account manager, else the creator. */
  owner_id: string;
  status: OpportunityStatus;
  /** Derived from evidence; recomputed whenever evidence changes. */
  stage: OpportunityStage;
  confidence: OpportunityConfidence;
  /** Value split — all BIGINT cents in currency_code. Hardware is split out of NRR. */
  mrr_cents: number;
  nrr_cents: number;
  hardware_cents: number;
  currency_code: string;
  /** True once an accepted-value quote is linked; manual value edits are then rejected. */
  values_locked_by_quote: boolean;
  expected_close_date?: ISO8601String | null;
  /**
   * The discipline invariant: while status === 'open', both fields are non-null.
   * Enforced at the action layer on create and on every action completion.
   */
  next_action?: string | null;
  next_action_due?: ISO8601String | null;
  /** Staleness anchor: updated by interactions, action completions, and quote events. */
  last_activity_at: ISO8601String;
  loss_reason?: OpportunityLossReason | null;
  loss_notes?: string | null;
  lost_to?: string | null;
  /** Provenance when generator-born. */
  generator_key?: OpportunityGeneratorKey | null;
  generator_context?: Record<string, unknown> | null;
  suggestion_id?: string | null;
  converted_contract_id?: string | null;
  converted_project_id?: string | null;
  won_at?: ISO8601String | null;
  lost_at?: ISO8601String | null;
  created_by: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
  last_nudged_at?: ISO8601String | null;
  last_escalated_at?: ISO8601String | null;
  overdue_notified_at?: ISO8601String | null;
}

/**
 * Append-only checkpoint facts. No delete path exists; corrections append
 * a note and stamp corrected_by/corrected_at on the corrected row.
 */
export interface IOpportunityEvidence extends TenantEntity {
  evidence_id: string;
  opportunity_id: string;
  checkpoint: OpportunityCheckpoint;
  source: OpportunityEvidenceSource;
  ref_type?: OpportunityEvidenceRefType | null;
  ref_id?: string | null;
  /** Human-readable fact summary, e.g. "Quote Q-2041 sent". */
  detail?: string | null;
  correction_note?: string | null;
  corrected_by?: string | null;
  corrected_at?: ISO8601String | null;
  /** User id, or null when recorded by the system from a domain event. */
  recorded_by?: string | null;
  recorded_at: ISO8601String;
}

export interface IOpportunitySuggestion extends TenantEntity {
  suggestion_id: string;
  generator_key: OpportunityGeneratorKey;
  client_id: string;
  title: string;
  /** Generator-specific evidence payload rendered by the suggestion UI and the why-sentence composer. */
  evidence: Record<string, unknown>;
  mrr_cents: number;
  nrr_cents: number;
  currency_code: string;
  status: OpportunitySuggestionStatus;
  snoozed_until?: ISO8601String | null;
  /** Stable per tenant+generator+subject; a dismissed key never refires. */
  dedupe_key: string;
  created_opportunity_id?: string | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IWhitespaceGridCategory {
  category_id: string;
  category_name: string;
  adopted_client_count: number;
  adoption_percentage: number;
  is_comparable: boolean;
}

export interface IWhitespaceGridClient {
  client_id: string;
  client_name: string;
  cells: Array<{ category_id: string; has_category: boolean }>;
}

export interface IWhitespaceGrid {
  active_contract_client_count: number;
  categories: IWhitespaceGridCategory[];
  clients: IWhitespaceGridClient[];
}

export interface ITmConversionMonthBucket {
  month: string;
  total_cents: number;
}

export interface ITmConversionOnePager {
  client_id: string;
  client_name: string;
  suggestion_id?: string | null;
  currency_code: string;
  monthly_totals: ITmConversionMonthBucket[];
  trailing_12_total_cents: number;
  monthly_avg_cents: number;
}

export interface IOpportunityDashboardSnapshot {
  open_count: number;
  pipeline_by_stage: Array<{
    stage: OpportunityStage;
    currency_code: string;
    opportunity_count: number;
    mrr_cents: number;
    nrr_cents: number;
  }>;
  queue_counts: {
    actions_due: number;
    stalled: number;
  };
}

/* ------------------------------------------------------------------ */
/* Why-sentences (the design language's fact-templated copy)           */
/* ------------------------------------------------------------------ */

/**
 * A composed why-sentence, rendered as segments so the UI can bold exactly
 * one clause. Composed server-side by the fact-templating engine — never
 * stored, always derived from current facts, no AI dependency.
 */
export interface WhySentence {
  segments: Array<{ text: string; emphasis?: boolean }>;
}

/* ------------------------------------------------------------------ */
/* View models                                                          */
/* ------------------------------------------------------------------ */

export interface IOpportunityListItem {
  opportunity_id: string;
  opportunity_number: string;
  title: string;
  client_id: string;
  client_name: string;
  client_lifecycle_status: ClientLifecycleStatus;
  owner_id: string;
  owner_name: string;
  status: OpportunityStatus;
  stage: OpportunityStage;
  confidence: OpportunityConfidence;
  opportunity_type: OpportunityType;
  mrr_cents: number;
  nrr_cents: number;
  hardware_cents: number;
  currency_code: string;
  expected_close_date?: ISO8601String | null;
  next_action?: string | null;
  next_action_due?: ISO8601String | null;
  days_since_activity: number;
  is_stalled: boolean;
}

export interface IOpportunityEvidenceLadderStep {
  checkpoint: OpportunityCheckpoint | 'identified';
  state: 'reached' | 'skipped' | 'pending';
  evidence?: Pick<IOpportunityEvidence, 'evidence_id' | 'source' | 'ref_type' | 'ref_id' | 'detail' | 'recorded_at'> | null;
}

export interface IOpportunityDetail extends IOpportunity {
  client_name: string;
  client_lifecycle_status: ClientLifecycleStatus;
  contact_name?: string | null;
  owner_name: string;
  ladder: IOpportunityEvidenceLadderStep[];
  linked_quotes: Array<{
    quote_id: string;
    quote_number: string;
    status: string;
    total_amount: number;
    currency_code: string;
    sent_at?: ISO8601String | null;
    accepted_at?: ISO8601String | null;
  }>;
  why: WhySentence;
}

/* ------------------------------------------------------------------ */
/* Work queue                                                           */
/* ------------------------------------------------------------------ */

export type QueueItemKind = 'action_due' | 'going_quiet' | 'suggestion';

export interface IQueueActionItem {
  kind: 'action_due' | 'going_quiet';
  opportunity_id: string;
  opportunity_number: string;
  title: string;
  client_name: string;
  stage: OpportunityStage;
  mrr_cents: number;
  nrr_cents: number;
  hardware_cents: number;
  currency_code: string;
  next_action?: string | null;
  next_action_due?: ISO8601String | null;
  days_overdue: number;
  days_since_activity: number;
  why: WhySentence;
  /** Exactly one queue item per screen carries the primary action. */
  is_screen_primary: boolean;
}

export interface IQueueSuggestionItem {
  kind: 'suggestion';
  suggestion_id: string;
  generator_key: OpportunityGeneratorKey;
  title: string;
  client_name: string;
  mrr_cents: number;
  nrr_cents: number;
  currency_code: string;
  how: string;
  why: WhySentence;
}

export interface IQueueLesson {
  /** e.g. 'assessment_conversion', 'quote_velocity' — from the insight library. */
  insight_key: string;
  why: WhySentence;
  action_label: string;
  action_href: string;
}

export interface IWorkQueue {
  user_first_name: string;
  date: ISO8601String;
  found_mrr_cents: number;
  found_nrr_cents: number;
  currency_code: string;
  do_today: IQueueActionItem[];
  going_quiet: IQueueActionItem[];
  money_found: IQueueSuggestionItem[];
  lesson?: IQueueLesson | null;
}

/* ------------------------------------------------------------------ */
/* Filters                                                              */
/* ------------------------------------------------------------------ */

export interface OpportunityListFilters {
  status?: OpportunityStatus | 'all';
  stage?: OpportunityStage;
  owner_id?: string;
  client_id?: string;
  opportunity_type?: OpportunityType;
  stalled_only?: boolean;
  search?: string;
  page?: number;
  page_size?: number;
  sort_by?: 'next_action_due' | 'expected_close_date' | 'mrr_cents' | 'last_activity_at' | 'created_at';
  sort_direction?: 'asc' | 'desc';
}

/* ------------------------------------------------------------------ */
/* Enterprise management layer                                         */
/* ------------------------------------------------------------------ */

export interface OpportunityPeriod {
  /** Inclusive date in YYYY-MM-DD form. */
  start: string;
  /** Inclusive date in YYYY-MM-DD form. */
  end: string;
}

export interface IForecastDealContribution {
  opportunity_id: string;
  opportunity_number: string;
  title: string;
  owner_id: string;
  status: OpportunityStatus;
  stage: OpportunityStage;
  currency_code: string;
  weight: number;
  weight_source: 'base' | 'seller_calibration' | 'won';
  floor_mrr_cents: number;
  floor_nrr_cents: number;
  ceiling_mrr_cents: number;
  ceiling_nrr_cents: number;
}

export interface IForecastBand {
  floor_mrr_cents: number;
  floor_nrr_cents: number;
  ceiling_mrr_cents: number;
  ceiling_nrr_cents: number;
  composition: IForecastDealContribution[];
}

export interface IOpportunityConfidenceOutcome {
  confidence: OpportunityConfidence;
  closed_count: number;
  won_count: number;
  close_rate: number;
}

export interface ISellerCalibration {
  seller_id: string;
  seller_name: string;
  closed_deal_count: number;
  calibrated: boolean;
  confidence_outcomes: IOpportunityConfidenceOutcome[];
  attach_rate: {
    won_new_logo_count: number;
    attached_count: number;
    rate: number;
  };
}

export interface IOpportunityMeetingSession extends TenantEntity {
  session_id: string;
  started_by: string;
  started_at: ISO8601String;
  created_at: ISO8601String;
}

export interface IOpportunityMeetingReview extends TenantEntity {
  review_id: string;
  session_id: string;
  opportunity_id: string;
  reviewed_at: ISO8601String;
  note?: string | null;
}

export interface IOpportunityMeetingSessionDetail extends IOpportunityMeetingSession {
  reviews: IOpportunityMeetingReview[];
}

export type OpportunityCommitmentResolutionStatus =
  | 'open'
  | 'quote_line'
  | 'agreement_line'
  | 'project_task'
  | 'declined';

export interface IOpportunityCommitment extends TenantEntity {
  commitment_id: string;
  opportunity_id: string;
  description: string;
  made_by: string;
  made_at: ISO8601String;
  resolution_status: OpportunityCommitmentResolutionStatus;
  resolution_ref_id?: string | null;
  resolved_by?: string | null;
  resolved_at?: ISO8601String | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export type OpportunityQbrTriggerKind = 'renewal' | 'asset_aging' | 'ticket_trend' | 'whitespace';

export interface IOpportunityQbrTrigger {
  trigger_key: string;
  kind: OpportunityQbrTriggerKind;
  title: string;
  evidence: Record<string, unknown>;
  opportunity_type: OpportunityType;
  generator_key?: OpportunityGeneratorKey | null;
  mrr_cents: number;
  nrr_cents: number;
  currency_code: string;
  default_next_action: string;
}

export interface IOpportunityQbrTriggerPack {
  client_id: string;
  client_name: string;
  account_manager_id?: string | null;
  triggers: IOpportunityQbrTrigger[];
}

export interface IOpportunityQbrYieldRow {
  client_id: string;
  client_name: string;
  account_manager_id?: string | null;
  account_manager_name?: string | null;
  triggers_fired: number;
  opportunities_created: number;
  opportunities_won: number;
}

export interface ISellerOpportunityRollup {
  owner_id: string;
  owner_name: string;
  office_id: null;
  office_name: null;
  open_mrr_cents: number;
  open_nrr_cents: number;
  won_count: number;
  won_mrr_cents: number;
  won_nrr_cents: number;
  lost_count: number;
  lost_mrr_cents: number;
  lost_nrr_cents: number;
  attach_rate: number;
}
