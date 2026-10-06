import type { Knex } from 'knex';

/**
 * Shared contracts for the questionnaire answer → account/asset mapping engine.
 * See docs/plans/2026-09-20-questionnaire-answer-mapping-plan.md §2-§7.
 */

export type MappingFieldDataType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'reference';

/** Per-field outcome status persisted on application result rows. */
export type MappingFieldStatus =
  | 'applied'
  | 'skipped_answer_absent'
  | 'skipped_no_change'
  | 'failed_validation'
  | 'failed_type_conversion'
  | 'failed_permission'
  | 'failed_asset_unresolved'
  | 'failed_asset_ambiguous';

/**
 * Run-level status. `pending` is a transient claim state written before field
 * processing so a concurrent same-tuple apply can be detected; the terminal
 * states are the four documented in the plan.
 */
export type MappingApplicationStatus =
  | 'pending'
  | 'applied'
  | 'partially_applied'
  | 'failed'
  | 'no_op';

export type MappingCoercionResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export type MappingValidationResult = { ok: true } | { ok: false; error: string };

/** A code-defined allowlisted destination field. */
export interface MappingTargetField {
  fieldKey: string;
  displayLabel: string;
  dataType: MappingFieldDataType;
  enumValues?: string[];
  coerce(raw: unknown): MappingCoercionResult;
  validate(value: unknown): MappingValidationResult;
  requiredPermission: { resource: string; action: string };
}

export interface AssetSelectorAnswerRef {
  strategy: 'answer-asset-ref';
  /** Question whose answer is the asset_id. */
  assetRefQuestionKey: string;
}

export interface AssetSelectorMatchAttribute {
  strategy: 'match-attribute';
  matchAttribute: 'asset_tag' | 'serial_number' | 'name';
  /** Question whose answer is matched against the attribute. */
  matchQuestionKey: string;
}

export type AssetSelector = AssetSelectorAnswerRef | AssetSelectorMatchAttribute;

/** One entry of a frozen mapping version's rules_snapshot. */
export interface MappingRule {
  ruleId: string;
  /** Stable formSchema field.key the answer is read from. */
  questionKey: string;
  /** Destination provider kind ('account' | 'asset'). */
  destinationKind: string;
  /** Allowlisted field within the kind. */
  targetFieldKey: string;
  /** Asset kind only. */
  assetSelector?: AssetSelector;
  /** Reserved coercion overrides. */
  transform?: Record<string, unknown>;
}

export interface MappingRulesSnapshot {
  rules: MappingRule[];
}

/** Immutable facts about the submission being mapped. */
export interface MappingSubmissionContext {
  submissionId: string;
  definitionId: string;
  definitionVersionId: string;
  clientId: string;
  contactId: string | null;
  requesterUserId: string | null;
  submittedPayload: Record<string, unknown>;
  /** The submission's frozen form_schema_snapshot. */
  formSchema: Record<string, unknown>;
}

export interface MappingResolveContext {
  knex: Knex;
  tenant: string;
  submission: MappingSubmissionContext;
  rule: MappingRule;
}

export interface ResolveTargetResult {
  ok: boolean;
  targetRef?: string;
  targetDisplay?: string;
  /** Set when `ok` is false. */
  errorCode?: MappingFieldStatus;
  errorDetail?: string;
}

export interface MappingApplyFieldContext {
  /** In apply mode this is the caller's transaction; in dry-run it is the base connection. */
  knex: Knex;
  tenant: string;
  submission: MappingSubmissionContext;
  rule: MappingRule;
  field: MappingTargetField;
  targetRef: string;
  targetDisplay: string;
  /** Coerced + validated answer value. */
  value: unknown;
  actorUserId: string;
  /** When true, read/compute but never write. */
  dryRun: boolean;
}

export interface ApplyFieldResult {
  status: 'applied' | 'skipped_no_change';
  beforeValue: unknown;
  afterValue: unknown;
}

export interface MappingDestinationProvider {
  kind: string;
  /** Translated label — never the raw key. */
  displayName: string;
  /** The allowlist; code-defined and closed. */
  listTargetFields(): MappingTargetField[];
  getTargetField(fieldKey: string): MappingTargetField | undefined;
  resolveTarget(ctx: MappingResolveContext): Promise<ResolveTargetResult>;
  applyField(ctx: MappingApplyFieldContext): Promise<ApplyFieldResult>;
}

export interface MappingRuleEvaluation {
  ruleId: string;
  questionKey: string;
  destinationKind: string;
  targetFieldKey: string;
  resolvedTargetRef: string | null;
  resolvedTargetDisplay: string | null;
  status: MappingFieldStatus;
  beforeValue: unknown;
  afterValue: unknown;
  errorCode: string | null;
  errorDetail: string | null;
}

export interface MappingApplicationSummary {
  total: number;
  applied: number;
  skipped: number;
  failed: number;
}

export interface MappingApplicationResultRecord {
  result_id: string;
  application_id: string;
  rule_id: string | null;
  question_key: string | null;
  destination_kind: string;
  target_field_key: string;
  resolved_target_ref: string | null;
  resolved_target_display: string | null;
  status: MappingFieldStatus;
  before_value: unknown;
  after_value: unknown;
  error_code: string | null;
  error_detail: string | null;
  created_at: Date;
}

export interface MappingApplicationRecord {
  application_id: string;
  submission_id: string;
  mapping_version_id: string;
  applied_by: string | null;
  applied_at: Date;
  status: MappingApplicationStatus;
  summary: MappingApplicationSummary | Record<string, unknown>;
  created_at: Date;
  results: MappingApplicationResultRecord[];
}
