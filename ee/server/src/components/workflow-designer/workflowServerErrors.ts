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

  // No match — return the raw server message so the user still sees something.
  return raw || fallback;
}

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
