import type { TFunction } from 'i18next';

/**
 * Translates server-action error strings thrown by the workflow actions into
 * localized user-facing toast copy. Follows the pattern described in
 * `.ai/translation/translation-guide.md#error-and-validation-translation-pattern`:
 * server actions return English strings, components map them to translation keys.
 *
 * Any message not matched by the map falls through to `fallback` so unmapped
 * server errors still render (in English) rather than the user getting a blank
 * toast.
 */
export function mapWorkflowServerError(
  t: TFunction,
  err: unknown,
  fallback: string,
): string {
  const raw = err instanceof Error ? err.message.trim() : typeof err === 'string' ? err.trim() : '';

  if (!raw) return fallback;

  const direct = KNOWN_ERROR_KEYS[raw];
  if (direct) return t(direct, { defaultValue: raw });

  // A few server errors interpolate a value (e.g. version numbers). Check patterns.
  const versionMatch = raw.match(/^Workflow version (\d+) already exists\. Refresh and retry\.$/);
  if (versionMatch) {
    return t('serverErrors.workflowVersionExists', {
      defaultValue: raw,
      version: versionMatch[1],
    });
  }

  // Infrastructure failures (the workflow engine is unreachable) surface as raw gRPC /
  // socket messages such as "Failed to connect before the deadline". Say what happened.
  if (isWorkflowEngineUnavailableMessage(raw)) {
    return t('serverErrors.workflowEngineUnavailable', {
      defaultValue: WORKFLOW_ENGINE_UNAVAILABLE_MESSAGE,
    });
  }

  // Schema validation failures arrive as a serialized list of zod issues
  // ([{"code":"invalid_type","path":["concurrencyLimit"],...}]). Say which fields are wrong.
  const validationIssues = parseValidationIssues(err, raw);
  if (validationIssues) {
    return t('serverErrors.invalidFields', {
      defaultValue: 'Some values are not valid: {{details}}',
      details: validationIssues.map((issue) => describeValidationIssue(t, issue)).join('; '),
    });
  }

  if (isWorkflowSessionExpiredError(err)) {
    return t('serverErrors.sessionExpired', {
      defaultValue: 'Your session has ended. Sign in again, then retry.',
    });
  }

  // No match — return the raw server message so the user still sees something.
  return raw || fallback;
}

type ValidationIssue = {
  code?: string;
  path?: Array<string | number>;
  message?: string;
  expected?: string;
  received?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
};

const isValidationIssueList = (value: unknown): value is ValidationIssue[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => item && typeof item === 'object' && Array.isArray((item as ValidationIssue).path));

const parseValidationIssues = (err: unknown, raw: string): ValidationIssue[] | null => {
  const issues = (err as { issues?: unknown } | null)?.issues;
  if (isValidationIssueList(issues)) return issues;
  if (!raw.startsWith('[')) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidationIssueList(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** "concurrencyLimit" → "Concurrency limit", "failure_rate_min_runs" → "Failure rate min runs". */
export const humanizeWorkflowFieldPath = (path: Array<string | number> | undefined): string => {
  const last = [...(path ?? [])].reverse().find((segment) => typeof segment === 'string') as string | undefined;
  if (!last) return '';
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const describeValidationIssue = (t: TFunction, issue: ValidationIssue): string => {
  const field = humanizeWorkflowFieldPath(issue.path) || t('serverErrors.fieldValue', { defaultValue: 'A value' });
  if (issue.code === 'invalid_type' && (issue.received === 'undefined' || issue.received === 'null')) {
    return t('serverErrors.issue.required', { defaultValue: '{{field}} is required', field });
  }
  if (issue.code === 'invalid_type' && issue.expected === 'number') {
    return t('serverErrors.issue.number', { defaultValue: '{{field}} must be a number', field });
  }
  if (issue.code === 'too_small' && issue.minimum !== undefined) {
    return t('serverErrors.issue.tooSmall', { defaultValue: '{{field}} must be at least {{minimum}}', field, minimum: String(issue.minimum) });
  }
  if (issue.code === 'too_big' && issue.maximum !== undefined) {
    return t('serverErrors.issue.tooBig', { defaultValue: '{{field}} must be at most {{maximum}}', field, maximum: String(issue.maximum) });
  }
  return issue.message ? `${field}: ${issue.message}` : field;
};

const SESSION_EXPIRED_PATTERNS: RegExp[] = [
  /^user not authenticated$/i,
  /^not authenticated$/i,
  /^unauthenticated$/i,
  /^unauthorized$/i,
  /^authentication required$/i,
  /session (has )?expired/i,
  /no (active )?session/i,
];

/**
 * True when a server action failed because the user's session is gone (withAuth's
 * AuthenticationError and similar), as opposed to a permission or validation failure.
 */
export const isWorkflowSessionExpiredError = (err: unknown): boolean => {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'AuthenticationError') return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return SESSION_EXPIRED_PATTERNS.some((pattern) => pattern.test(message.trim()));
};

export const WORKFLOW_ENGINE_UNAVAILABLE_MESSAGE =
  'The workflow engine could not be reached. Try again in a few minutes. If this keeps happening, ask an administrator to check the workflow service.';

// Keep in sync with RUNTIME_UNAVAILABLE_PATTERNS in ee/packages/workflows/src/lib/workflowRunLauncher.ts,
// which classifies the same failures server-side for run launches.
const WORKFLOW_ENGINE_UNAVAILABLE_PATTERNS: RegExp[] = [
  /failed to connect before the deadline/i,
  /\bUNAVAILABLE\b/,
  /\bDEADLINE_EXCEEDED\b/,
  /\bECONNREFUSED\b/,
  /\bECONNRESET\b/,
  /\bETIMEDOUT\b/,
  /\bENOTFOUND\b/,
  /\bEAI_AGAIN\b/,
  /getaddrinfo/i,
  /name resolution failed/i,
  /no connection established/i,
];

export const isWorkflowEngineUnavailableMessage = (message: string): boolean =>
  WORKFLOW_ENGINE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message));

const KNOWN_ERROR_KEYS: Record<string, string> = {
  // Authentication / authorization
  'Forbidden': 'serverErrors.forbidden',
  'Unauthorized': 'serverErrors.unauthorized',
  'Not found': 'serverErrors.notFound',

  // Common workflow lookup
  'Workflow not found': 'serverErrors.workflowNotFound',
  'Workflow version not found': 'serverErrors.workflowVersionNotFound',
  'Workflow validation failed': 'serverErrors.workflowValidationFailed',
  'Workflow has no published versions': 'serverErrors.noPublishedVersions',

  // Run-start blockers
  'Workflow is paused': 'serverErrors.workflowPaused',
  'Workflow concurrency limit reached': 'serverErrors.concurrencyLimitReached',
  'Workflow run rate limit exceeded': 'serverErrors.rateLimitExceeded',
  'Payload must be JSON serializable': 'serverErrors.payloadNotSerializable',
  'Payload exceeds maximum size': 'serverErrors.payloadTooLarge',
  'Payload failed validation': 'serverErrors.payloadValidationFailed',
  'Workflow has no payload schema ref': 'serverErrors.missingPayloadSchemaRef',
  'Missing sourcePayloadSchemaRef for event payload': 'serverErrors.missingSourcePayloadSchemaRef',
  'Trigger mapping is required for this run': 'serverErrors.triggerMappingRequired',

  // Run actions (retry / cancel / resume / replay)
  'Run is not failed': 'serverErrors.runNotFailed',
  'Failed step not found': 'serverErrors.failedStepNotFound',
  'No event wait found for run': 'serverErrors.noEventWaitFound',
  'Failed to cancel Temporal-backed workflow run': 'serverErrors.cancelTemporalRunFailed',

  // Publish / delete
  'No definition to publish': 'serverErrors.noDefinitionToPublish',
  'Cannot delete workflow with active runs. Cancel all runs first.': 'serverErrors.deleteActiveRunsBlocked',

  // Schedule validation
  'One-time schedules require a runAt timestamp.': 'serverErrors.scheduleOneTimeRunAtRequired',
  'One-time schedules require a valid ISO 8601 timestamp.': 'serverErrors.scheduleOneTimeInvalidTimestamp',
  'One-time schedules must be scheduled in the future.': 'serverErrors.scheduleOneTimeMustBeFuture',
  'One-time schedules only support "Any day".': 'serverErrors.scheduleOneTimeDayOfWeek',
  'One-time schedules cannot set a business-hours schedule override.': 'serverErrors.scheduleOneTimeBusinessHours',
  'Recurring schedules require a cron expression.': 'serverErrors.scheduleRecurringCronRequired',
  'Recurring schedules require a 5-field cron expression.': 'serverErrors.scheduleRecurringCronFields',
  'Recurring schedules require a valid IANA timezone.': 'serverErrors.scheduleRecurringTimezone',
  'Cron expression too long.': 'serverErrors.cronTooLong',
  'Cron expression contains unsupported characters.': 'serverErrors.cronUnsupportedCharacters',
  'Cron cannot set both day-of-month and day-of-week.': 'serverErrors.cronDayConflict',
  'Cron too frequent (minimum interval is 5 minutes).': 'serverErrors.cronTooFrequent',
  'Schedules can only be created for workflows with a published version.': 'serverErrors.schedulePublishedRequired',
  'Schedules are only supported for workflows with a pinned payload schema.': 'serverErrors.schedulePinnedSchemaRequired',
  'The latest published workflow version does not have a registered pinned payload schema.': 'serverErrors.scheduleSchemaNotRegistered',
  'Schedule payload failed validation against the workflow payload schema.': 'serverErrors.schedulePayloadInvalid',

  // Event processing
  'Failed to process workflow event': 'serverErrors.processEventFailed',
};
