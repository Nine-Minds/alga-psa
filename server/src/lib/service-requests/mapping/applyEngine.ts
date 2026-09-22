import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth';
import { tenantDb } from '@alga-psa/db';
import {
  getMappingDestinationProvider,
} from './destinations';
import { normalizeRulesSnapshot } from './mappingRules';
import { isUniqueViolationOnIndex } from '../pgUniqueConstraint';
import { recordServiceRequestSubmissionAudit } from '../submissionAudit';
import type {
  ApplyFieldResult,
  MappingApplicationRecord,
  MappingApplicationResultRecord,
  MappingApplicationStatus,
  MappingApplicationSummary,
  MappingFieldStatus,
  MappingRule,
  MappingRuleEvaluation,
  MappingRulesSnapshot,
  MappingSubmissionContext,
  MappingTargetField,
} from './types';

/**
 * Answer-mapping apply engine. `dryRun` (preview) and `apply` share one code
 * path; the only difference is whether destination writes and result rows are
 * persisted. Each applied field's destination write, its result row, and its
 * audit event commit in one transaction (plan §7).
 */

const APPLICATIONS_UNIQUE_INDEX =
  'service_request_submission_applications_replay_unique';
const APPLICATION_SETTLE_TIMEOUT_MS = 15000;
const APPLICATION_SETTLE_POLL_MS = 100;
/**
 * How long a `pending` claim may go without a heartbeat before a retry treats
 * it as abandoned. Every field transaction refreshes `claimed_at`, so a live
 * run stays fresh; a crashed run's claim goes stale and can be taken over.
 */
const APPLICATION_CLAIM_STALE_MS = 30000;

export interface RunAnswerMappingInput {
  knex: Knex;
  tenant: string;
  submissionId: string;
  mappingVersionId?: string | null;
  actorUserId: string;
  actorUser: IUser;
}

export interface AnswerMappingPreviewResult {
  submissionId: string;
  mappingVersionId: string;
  mappingVersionNumber: number;
  results: MappingRuleEvaluation[];
}

export interface ApplyAnswerMappingResult extends MappingApplicationRecord {
  /** True when this call observed an existing (in-flight or prior) run instead of creating one. */
  replayed: boolean;
}

interface SubmissionRow {
  submission_id: string;
  definition_id: string;
  definition_version_id: string;
  client_id: string;
  contact_id: string | null;
  requester_user_id: string | null;
  submitted_payload: Record<string, unknown>;
}

interface DefinitionVersionRow {
  version_id: string;
  version_number: number;
  form_schema_snapshot: Record<string, unknown>;
}

interface MappingVersionRow {
  version_id: string;
  mapping_id: string;
  definition_id: string;
  version_number: number;
  rules_snapshot: MappingRulesSnapshot;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFormFields(formSchema: Record<string, unknown>): Array<{ key?: unknown }> {
  const fields = (formSchema as { fields?: unknown }).fields;
  return Array.isArray(fields) ? (fields as Array<{ key?: unknown }>) : [];
}

async function loadSubmissionContext(
  knex: Knex,
  tenant: string,
  submissionId: string
): Promise<{ submission: SubmissionRow; definitionVersion: DefinitionVersionRow }> {
  const db = tenantDb(knex, tenant);
  const submission = await db
    .table('service_request_submissions')
    .where({ submission_id: submissionId })
    .first<SubmissionRow | undefined>(
      'submission_id',
      'definition_id',
      'definition_version_id',
      'client_id',
      'contact_id',
      'requester_user_id',
      'submitted_payload'
    );
  if (!submission) {
    throw new Error('Service request submission not found');
  }
  const definitionVersion = await db
    .table('service_request_definition_versions')
    .where({ version_id: submission.definition_version_id })
    .first<DefinitionVersionRow | undefined>(
      'version_id',
      'version_number',
      'form_schema_snapshot'
    );
  if (!definitionVersion) {
    throw new Error('Service request definition version not found');
  }
  return { submission, definitionVersion };
}

async function resolveMappingVersion(
  knex: Knex,
  tenant: string,
  definitionId: string,
  mappingVersionId?: string | null
): Promise<MappingVersionRow> {
  const db = tenantDb(knex, tenant);
  if (mappingVersionId) {
    const version = await db
      .table('service_request_answer_mapping_versions')
      .where({ version_id: mappingVersionId })
      .first<MappingVersionRow | undefined>(
        'version_id',
        'mapping_id',
        'definition_id',
        'version_number',
        'rules_snapshot'
      );
    if (!version || version.definition_id !== definitionId) {
      throw new Error('Answer mapping version not found for this definition');
    }
    return version;
  }

  const mapping = await db
    .table('service_request_answer_mappings')
    .where({ definition_id: definitionId })
    .first<{ current_version_id: string | null } | undefined>('current_version_id');
  if (!mapping?.current_version_id) {
    throw new Error('No published answer mapping for this definition');
  }
  const version = await db
    .table('service_request_answer_mapping_versions')
    .where({ version_id: mapping.current_version_id })
    .first<MappingVersionRow | undefined>(
      'version_id',
      'mapping_id',
      'definition_id',
      'version_number',
      'rules_snapshot'
    );
  if (!version) {
    throw new Error('Published answer mapping version not found');
  }
  return version;
}

function buildSubmissionContext(
  submission: SubmissionRow,
  definitionVersion: DefinitionVersionRow
): MappingSubmissionContext {
  return {
    submissionId: submission.submission_id,
    definitionId: submission.definition_id,
    definitionVersionId: submission.definition_version_id,
    clientId: submission.client_id,
    contactId: submission.contact_id,
    requesterUserId: submission.requester_user_id,
    submittedPayload: submission.submitted_payload ?? {},
    formSchema: definitionVersion.form_schema_snapshot ?? {},
  };
}

function baseEvaluation(rule: MappingRule): MappingRuleEvaluation {
  return {
    ruleId: rule.ruleId,
    questionKey: rule.questionKey,
    destinationKind: rule.destinationKind,
    targetFieldKey: rule.targetFieldKey,
    resolvedTargetRef: null,
    resolvedTargetDisplay: null,
    status: 'failed_validation',
    beforeValue: null,
    afterValue: null,
    errorCode: null,
    errorDetail: null,
  };
}

function isClaimStale(claimedAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!claimedAt) {
    return true;
  }
  const claimedMs = new Date(claimedAt).getTime();
  return Number.isNaN(claimedMs) || now - claimedMs >= APPLICATION_CLAIM_STALE_MS;
}

/**
 * Runs a destination write. In apply mode `knex` is the per-field transaction,
 * so the write runs in a nested transaction (savepoint): a SQL rejection rolls
 * back only the failed destination write and leaves the outer transaction
 * usable for the result row and audit event. Without this, a 22P02/22001 would
 * abort the whole per-field transaction and the following INSERTs would fail
 * with 25P02, aborting the run. In dry-run nothing is written and no savepoint
 * is needed.
 */
async function applyDestinationField(
  knex: Knex,
  dryRun: boolean,
  write: (writeKnex: Knex) => Promise<ApplyFieldResult>
): Promise<ApplyFieldResult> {
  if (dryRun) {
    return write(knex);
  }
  return knex.transaction((savepoint) => write(savepoint));
}

function isSqlStateClass(error: unknown, classPrefix: string): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith(classPrefix);
}

/**
 * Turns a destination rejection into a per-field outcome. SQLSTATE class 22
 * (data exception, e.g. 22P02 invalid text representation, 22001 value too
 * long) is a type-conversion failure; other SQL/validation rejections are
 * validation failures. The message is deliberately clean — driver text is not
 * surfaced to the admin.
 */
function describeDestinationRejection(
  error: unknown,
  field: MappingTargetField
): { status: MappingFieldStatus; detail: string } {
  if (isSqlStateClass(error, '22')) {
    return {
      status: 'failed_type_conversion',
      detail: `The destination rejected the value as invalid for "${field.displayLabel}"`,
    };
  }
  if (isSqlStateClass(error, '23')) {
    return {
      status: 'failed_validation',
      detail: `The destination rejected the value: it violates a constraint on "${field.displayLabel}"`,
    };
  }
  return {
    status: 'failed_validation',
    detail: `The destination rejected the value for "${field.displayLabel}"`,
  };
}

/**
 * Evaluates one rule. In apply mode `knex` is the field transaction; in
 * dry-run it is the base connection and no write happens.
 */
async function evaluateRule(
  input: {
    knex: Knex;
    tenant: string;
    submission: MappingSubmissionContext;
    actorUser: IUser;
    actorUserId: string;
    dryRun: boolean;
  },
  rule: MappingRule
): Promise<MappingRuleEvaluation> {
  const evaluation = baseEvaluation(rule);
  const { knex, tenant, submission } = input;

  const questionExists = getFormFields(submission.formSchema).some(
    (field) => field?.key === rule.questionKey
  );
  if (!questionExists) {
    evaluation.status = 'skipped_answer_absent';
    evaluation.errorDetail = 'Question is not present in the submission form schema';
    return evaluation;
  }

  const answer = submission.submittedPayload[rule.questionKey];
  if (answer === undefined || answer === null) {
    evaluation.status = 'skipped_answer_absent';
    evaluation.errorDetail = 'Answer is absent from the submission';
    return evaluation;
  }

  const provider = getMappingDestinationProvider(rule.destinationKind);
  if (!provider) {
    evaluation.status = 'failed_validation';
    evaluation.errorCode = 'unknown_destination_kind';
    evaluation.errorDetail = `Unknown destination kind "${rule.destinationKind}"`;
    return evaluation;
  }

  const targetField = provider.getTargetField(rule.targetFieldKey);
  if (!targetField) {
    evaluation.status = 'failed_validation';
    evaluation.errorCode = 'target_not_allowed';
    evaluation.errorDetail = `"${rule.targetFieldKey}" is not an allowed target for ${provider.displayName}`;
    return evaluation;
  }

  const resolved = await provider.resolveTarget({ knex, tenant, submission, rule });
  if (!resolved.ok || !resolved.targetRef) {
    evaluation.status = (resolved.errorCode ?? 'failed_validation') as MappingFieldStatus;
    evaluation.errorCode = evaluation.status;
    evaluation.errorDetail = resolved.errorDetail ?? 'Destination target could not be resolved';
    return evaluation;
  }
  const resolvedTargetRef = resolved.targetRef;
  evaluation.resolvedTargetRef = resolvedTargetRef;
  evaluation.resolvedTargetDisplay = resolved.targetDisplay ?? null;

  const coerced = targetField.coerce(answer);
  if (!coerced.ok) {
    evaluation.status = 'failed_type_conversion';
    evaluation.errorCode = 'type_conversion';
    evaluation.errorDetail = coerced.error;
    return evaluation;
  }

  const validated = targetField.validate(coerced.value);
  if (!validated.ok) {
    evaluation.status = 'failed_validation';
    evaluation.errorCode = 'validation';
    evaluation.errorDetail = validated.error;
    return evaluation;
  }

  const permitted = await hasPermission(
    input.actorUser,
    targetField.requiredPermission.resource,
    targetField.requiredPermission.action,
    knex
  );
  if (!permitted) {
    evaluation.status = 'failed_permission';
    evaluation.errorCode = 'permission';
    evaluation.errorDetail = `Missing ${targetField.requiredPermission.resource}:${targetField.requiredPermission.action}`;
    return evaluation;
  }

  // The applier writes through the destination's own validated entrypoint
  // (ClientModel.updateClient / updateAssetRecord). A rejection there is a
  // per-field outcome, never a run abort: the destination write runs in a
  // savepoint, so a SQL rejection rolls back only that write and the field is
  // recorded as a failure while every other field still applies (plan §6.3).
  try {
    const applied = await applyDestinationField(knex, input.dryRun, (writeKnex) =>
      provider.applyField({
        knex: writeKnex,
        tenant,
        submission,
        rule,
        field: targetField,
        targetRef: resolvedTargetRef,
        targetDisplay: resolved.targetDisplay ?? '',
        value: coerced.value,
        actorUserId: input.actorUserId,
        dryRun: input.dryRun,
      })
    );
    evaluation.status = applied.status;
    evaluation.beforeValue = applied.beforeValue ?? null;
    evaluation.afterValue = applied.afterValue ?? null;
  } catch (error) {
    const rejection = describeDestinationRejection(error, targetField);
    evaluation.status = rejection.status;
    evaluation.errorCode = 'destination_rejected';
    evaluation.errorDetail = rejection.detail;
  }
  return evaluation;
}

function computeSummary(results: MappingRuleEvaluation[]): MappingApplicationSummary {
  const applied = results.filter((result) => result.status === 'applied').length;
  const failed = results.filter((result) => result.status.startsWith('failed_')).length;
  const skipped = results.length - applied - failed;
  return { total: results.length, applied, skipped, failed };
}

function computeApplicationStatus(results: MappingRuleEvaluation[]): MappingApplicationStatus {
  const summary = computeSummary(results);
  if (summary.total === 0) {
    return 'no_op';
  }
  if (summary.failed === summary.total) {
    return 'failed';
  }
  if (summary.failed > 0) {
    return 'partially_applied';
  }
  if (summary.applied === 0) {
    return 'no_op';
  }
  return 'applied';
}

function toJsonbParam(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function resultRowFromEvaluation(
  tenant: string,
  applicationId: string,
  evaluation: MappingRuleEvaluation
): Record<string, unknown> {
  return {
    tenant,
    application_id: applicationId,
    rule_id: evaluation.ruleId,
    question_key: evaluation.questionKey,
    destination_kind: evaluation.destinationKind,
    target_field_key: evaluation.targetFieldKey,
    resolved_target_ref: evaluation.resolvedTargetRef,
    resolved_target_display: evaluation.resolvedTargetDisplay,
    status: evaluation.status,
    // jsonb columns: scalars must be serialized explicitly — the pg driver only
    // auto-encodes objects, and a bare string is not valid JSON input.
    before_value: toJsonbParam(evaluation.beforeValue),
    after_value: toJsonbParam(evaluation.afterValue),
    error_code: evaluation.errorCode,
    error_detail: evaluation.errorDetail,
  };
}

async function recordFieldAudit(
  trx: Knex.Transaction,
  tenant: string,
  submissionId: string,
  actorUserId: string,
  evaluation: MappingRuleEvaluation
): Promise<void> {
  if (evaluation.status === 'skipped_answer_absent') {
    return;
  }
  const isFailure = evaluation.status.startsWith('failed_');
  await recordServiceRequestSubmissionAudit(
    trx,
    tenant,
    isFailure
      ? 'service_request_submission_mapping_field_failed'
      : 'service_request_submission_mapping_field_applied',
    {
      submissionId,
      userId: actorUserId,
      changedData: {
        target_field_key: evaluation.targetFieldKey,
        before_value: evaluation.beforeValue,
        after_value: evaluation.afterValue,
      },
      details: {
        destination_kind: evaluation.destinationKind,
        resolved_target_ref: evaluation.resolvedTargetRef,
        status: evaluation.status,
        error_code: evaluation.errorCode,
      },
    }
  );
}

/** Internal claim row: the application record plus its liveness heartbeat. */
interface ApplicationClaimRow extends MappingApplicationRecord {
  claimed_at: Date;
}

async function loadApplicationRow(
  knex: Knex,
  tenant: string,
  submissionId: string,
  mappingVersionId: string
): Promise<ApplicationClaimRow | undefined> {
  return tenantDb(knex, tenant)
    .table('service_request_submission_applications')
    .where({ submission_id: submissionId, mapping_version_id: mappingVersionId })
    .first<ApplicationClaimRow | undefined>(
      'application_id',
      'submission_id',
      'mapping_version_id',
      'applied_by',
      'applied_at',
      'status',
      'summary',
      'created_at',
      'claimed_at'
    );
}

export async function loadApplicationResults(
  knex: Knex,
  tenant: string,
  applicationId: string
): Promise<MappingApplicationResultRecord[]> {
  const rows = await tenantDb(knex, tenant)
    .table('service_request_submission_application_results')
    .where({ application_id: applicationId })
    .orderBy('created_at', 'asc')
    .select(
      'result_id',
      'application_id',
      'rule_id',
      'question_key',
      'destination_kind',
      'target_field_key',
      'resolved_target_ref',
      'resolved_target_display',
      'status',
      'before_value',
      'after_value',
      'error_code',
      'error_detail',
      'created_at'
    );
  return rows as unknown as MappingApplicationResultRecord[];
}

export async function loadApplicationRecord(
  knex: Knex,
  tenant: string,
  applicationId: string
): Promise<MappingApplicationRecord | undefined> {
  const row = await tenantDb(knex, tenant)
    .table('service_request_submission_applications')
    .where({ application_id: applicationId })
    .first<MappingApplicationRecord | undefined>(
      'application_id',
      'submission_id',
      'mapping_version_id',
      'applied_by',
      'applied_at',
      'status',
      'summary',
      'created_at'
    );
  if (!row) {
    return undefined;
  }
  return { ...row, results: await loadApplicationResults(knex, tenant, applicationId) };
}

export async function listApplicationsForSubmission(
  knex: Knex,
  tenant: string,
  submissionId: string
): Promise<MappingApplicationRecord[]> {
  const rows = await tenantDb(knex, tenant)
    .table('service_request_submission_applications')
    .where({ submission_id: submissionId })
    .orderBy('applied_at', 'desc')
    .select(
      'application_id',
      'submission_id',
      'mapping_version_id',
      'applied_by',
      'applied_at',
      'status',
      'summary',
      'created_at'
    );
  const records = rows as unknown as MappingApplicationRecord[];
  return Promise.all(
    records.map(async (record) => ({
      ...record,
      results: await loadApplicationResults(knex, tenant, record.application_id),
    }))
  );
}

/** Shared setup for preview and apply. */
async function prepareRun(input: RunAnswerMappingInput): Promise<{
  submission: MappingSubmissionContext;
  mappingVersion: MappingVersionRow;
  rules: MappingRule[];
}> {
  const { submission, definitionVersion } = await loadSubmissionContext(
    input.knex,
    input.tenant,
    input.submissionId
  );
  const mappingVersion = await resolveMappingVersion(
    input.knex,
    input.tenant,
    submission.definition_id,
    input.mappingVersionId
  );
  const rules = normalizeRulesSnapshot(mappingVersion.rules_snapshot).rules;
  return {
    submission: buildSubmissionContext(submission, definitionVersion),
    mappingVersion,
    rules,
  };
}

export async function previewAnswerMapping(
  input: RunAnswerMappingInput
): Promise<AnswerMappingPreviewResult> {
  const { submission, mappingVersion, rules } = await prepareRun(input);
  const results: MappingRuleEvaluation[] = [];
  for (const rule of rules) {
    results.push(
      await evaluateRule(
        {
          knex: input.knex,
          tenant: input.tenant,
          submission,
          actorUser: input.actorUser,
          actorUserId: input.actorUserId,
          dryRun: true,
        },
        rule
      )
    );
  }
  return {
    submissionId: submission.submissionId,
    mappingVersionId: mappingVersion.version_id,
    mappingVersionNumber: mappingVersion.version_number,
    results,
  };
}

async function claimApplication(
  input: RunAnswerMappingInput,
  mappingVersionId: string
): Promise<{ applicationId: string; replayed: MappingApplicationRecord | null }> {
  const { knex, tenant, submissionId } = input;
  try {
    const [created] = await tenantDb(knex, tenant)
      .table('service_request_submission_applications')
      .insert({
        tenant,
        submission_id: submissionId,
        mapping_version_id: mappingVersionId,
        applied_by: input.actorUserId,
        status: 'pending',
        summary: {},
      })
      .returning('application_id');
    return { applicationId: created.application_id as string, replayed: null };
  } catch (error) {
    if (!isUniqueViolationOnIndex(error, APPLICATIONS_UNIQUE_INDEX)) {
      throw error;
    }
    const existing = await loadApplicationRow(knex, tenant, submissionId, mappingVersionId);
    if (!existing) {
      throw error;
    }
    if (existing.status === 'pending' && !isClaimStale(existing.claimed_at)) {
      // A live concurrent run owns the claim. Wait for it to settle so a
      // concurrent second apply converges to skipped_no_change like a
      // sequential retry. A stale claim (no heartbeat within
      // APPLICATION_CLAIM_STALE_MS) is treated as abandoned and skipped
      // straight to takeover instead of blocking.
      const deadline = Date.now() + APPLICATION_SETTLE_TIMEOUT_MS;
      let settled = existing;
      while (
        settled.status === 'pending' &&
        !isClaimStale(settled.claimed_at) &&
        Date.now() < deadline
      ) {
        await sleep(APPLICATION_SETTLE_POLL_MS);
        const reloaded = await loadApplicationRow(knex, tenant, submissionId, mappingVersionId);
        if (!reloaded) break;
        settled = reloaded;
      }
      if (settled.status === 'pending' && !isClaimStale(settled.claimed_at)) {
        // Still genuinely owned by a live run: report it rather than racing.
        return {
          applicationId: existing.application_id,
          replayed: await loadApplicationRecord(knex, tenant, existing.application_id) ?? {
            ...existing,
            results: [],
          },
        };
      }
    }
    // Sequential retry, a settled concurrent run, or an abandoned claim:
    // reset and re-run. The heartbeat is refreshed so a subsequent concurrent
    // caller sees a live claim.
    await knex.transaction(async (trx) => {
      const db = tenantDb(trx, tenant);
      await db
        .table('service_request_submission_application_results')
        .where({ application_id: existing.application_id })
        .delete();
      await db
        .table('service_request_submission_applications')
        .where({ application_id: existing.application_id })
        .update({
          status: 'pending',
          summary: {},
          applied_by: input.actorUserId,
          applied_at: trx.fn.now(),
          claimed_at: trx.fn.now(),
        });
    });
    return { applicationId: existing.application_id, replayed: null };
  }
}

export async function applyAnswerMapping(
  input: RunAnswerMappingInput
): Promise<ApplyAnswerMappingResult> {
  const { submission, mappingVersion, rules } = await prepareRun(input);
  const claim = await claimApplication(input, mappingVersion.version_id);

  if (claim.replayed) {
    return { ...claim.replayed, replayed: true };
  }

  const results: MappingRuleEvaluation[] = [];
  for (const rule of rules) {
    const evaluation = await input.knex.transaction(async (trx) => {
      // Heartbeat: proves this claim has a live owner. A retry only treats a
      // `pending` row as abandoned once this goes stale.
      await tenantDb(trx, input.tenant)
        .table('service_request_submission_applications')
        .where({ application_id: claim.applicationId })
        .update({ claimed_at: trx.fn.now() });
      const evaluation = await evaluateRule(
        {
          knex: trx,
          tenant: input.tenant,
          submission,
          actorUser: input.actorUser,
          actorUserId: input.actorUserId,
          dryRun: false,
        },
        rule
      );
      await tenantDb(trx, input.tenant)
        .table('service_request_submission_application_results')
        .insert(resultRowFromEvaluation(input.tenant, claim.applicationId, evaluation));
      await recordFieldAudit(trx, input.tenant, submission.submissionId, input.actorUserId, evaluation);
      return evaluation;
    });
    results.push(evaluation);
  }

  const status = computeApplicationStatus(results);
  const summary = computeSummary(results);

  await input.knex.transaction(async (trx) => {
    await tenantDb(trx, input.tenant)
      .table('service_request_submission_applications')
      .where({ application_id: claim.applicationId })
      .update({ status, summary, applied_at: trx.fn.now() });
    await recordServiceRequestSubmissionAudit(
      trx,
      input.tenant,
      'service_request_submission_mapping_applied',
      {
        submissionId: submission.submissionId,
        userId: input.actorUserId,
        changedData: {},
        details: {
          mapping_version_id: mappingVersion.version_id,
          status,
          applied: summary.applied,
          skipped: summary.skipped,
          failed: summary.failed,
        },
      }
    );
  });

  const record = await loadApplicationRecord(input.knex, input.tenant, claim.applicationId);
  if (!record) {
    throw new Error('Application record disappeared after apply');
  }
  return { ...record, replayed: false };
}
