/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';

import {
  humanizeWorkflowFieldPath,
  isWorkflowSessionExpiredError,
  mapWorkflowServerError,
} from '../workflowServerErrors';
import { buildWorkflowMetadataDraft, buildWorkflowMetadataUpdate } from '../workflowMetadataDraft';
import {
  clearWorkflowDraftBackup,
  readWorkflowDraftBackup,
  shouldOfferWorkflowDraftBackup,
  workflowDraftBackupKey,
  writeWorkflowDraftBackup,
} from '../workflowDraftBackup';
import { buildOptionalTimezoneOptions } from '../workflowTimezoneOptions';

const t = ((key: string, options?: Record<string, unknown>) => {
  let text = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) text = text.replace(`{{${name}}}`, String(value));
  return text;
}) as any;

describe('workflow settings errors', () => {
  it('turns a serialized validation error into plain language', () => {
    const raw = JSON.stringify([
      { code: 'invalid_type', expected: 'number', received: 'undefined', path: ['concurrencyLimit'], message: 'Required' },
    ]);
    expect(mapWorkflowServerError(t, new Error(raw), 'fallback')).toBe('Some values are not valid: Concurrency limit is required');
  });

  it('describes range errors and reads zod-style issues objects', () => {
    const error = Object.assign(new Error('Validation failed'), {
      issues: [
        { code: 'too_big', maximum: 1, path: ['failureRateThreshold'], message: 'Too big' },
        { code: 'invalid_type', expected: 'number', received: 'string', path: ['failure_rate_min_runs'], message: 'Expected number' },
      ],
    });
    expect(mapWorkflowServerError(t, error, 'fallback')).toBe(
      'Some values are not valid: Failure rate threshold must be at most 1; Failure rate min runs must be a number'
    );
  });

  it('leaves ordinary messages alone', () => {
    expect(mapWorkflowServerError(t, new Error('Something else broke'), 'fallback')).toBe('Something else broke');
    expect(mapWorkflowServerError(t, new Error('[not json'), 'fallback')).toBe('[not json');
    expect(humanizeWorkflowFieldPath(['steps', 0, 'saveAs'])).toBe('Save as');
  });

  it('recognizes lost sessions but not permission errors', () => {
    expect(isWorkflowSessionExpiredError(new Error('User not authenticated'))).toBe(true);
    expect(isWorkflowSessionExpiredError(Object.assign(new Error('x'), { name: 'AuthenticationError' }))).toBe(true);
    expect(isWorkflowSessionExpiredError(new Error('Forbidden'))).toBe(false);
    expect(isWorkflowSessionExpiredError(new Error('Permission denied: Cannot view tickets'))).toBe(false);
  });
});

describe('workflow settings draft', () => {
  it('sends blank numeric settings as null, which clears them', () => {
    const draft = buildWorkflowMetadataDraft({ is_paused: false, concurrency_limit: null, failure_rate_threshold: '0.5' });
    expect(draft).toMatchObject({ concurrencyLimit: '', failureRateThreshold: '0.5', isPaused: false });
    expect(buildWorkflowMetadataUpdate('wf-1', { ...draft, isPaused: true })).toEqual({
      workflowId: 'wf-1',
      isVisible: true,
      isPaused: true,
      concurrencyLimit: null,
      autoPauseOnFailure: false,
      failureRateThreshold: 0.5,
      failureRateMinRuns: null,
    });
    expect(buildWorkflowMetadataUpdate('wf-1', { ...draft, concurrencyLimit: ' 4 ' }).concurrencyLimit).toBe(4);
  });
});

describe('local draft backup', () => {
  afterEach(() => window.localStorage.clear());
  const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

  it('round-trips per workflow and clears', () => {
    writeWorkflowDraftBackup('wf-1', { definition: { name: 'Edited' }, baseDefinition: { name: 'Saved' }, savedAt: '2026-10-03T00:00:00.000Z' });
    expect(readWorkflowDraftBackup('wf-1')).toEqual({ definition: { name: 'Edited' }, baseDefinition: { name: 'Saved' }, savedAt: '2026-10-03T00:00:00.000Z' });
    expect(readWorkflowDraftBackup('wf-2')).toBeNull();
    clearWorkflowDraftBackup('wf-1');
    expect(readWorkflowDraftBackup('wf-1')).toBeNull();
    expect(workflowDraftBackupKey(null)).toContain('new');
  });

  it('ignores unreadable entries', () => {
    window.localStorage.setItem(workflowDraftBackupKey('wf-1'), '{oops');
    expect(readWorkflowDraftBackup('wf-1')).toBeNull();
  });

  it('offers a backup only for edits made on top of what is saved now', () => {
    const backup = { definition: { name: 'Edited' }, baseDefinition: { name: 'Saved' }, savedAt: 'x' };
    expect(shouldOfferWorkflowDraftBackup(backup, { name: 'Saved' }, equal)).toBe(true);
    expect(shouldOfferWorkflowDraftBackup(backup, { name: 'Saved again elsewhere' }, equal)).toBe(false);
    expect(shouldOfferWorkflowDraftBackup({ ...backup, definition: { name: 'Saved' } }, { name: 'Saved' }, equal)).toBe(false);
    expect(shouldOfferWorkflowDraftBackup({ definition: { name: 'New' }, baseDefinition: null, savedAt: 'x' }, null, equal)).toBe(true);
    expect(shouldOfferWorkflowDraftBackup(null, null, equal)).toBe(false);
  });
});

describe('optional timezone options', () => {
  it('starts with the tenant default and keeps an unknown saved value', () => {
    const options = buildOptionalTimezoneOptions('Tenant timezone (default)', 'Mars/Olympus', ['America/New_York', 'UTC']);
    expect(options[0]).toEqual({ value: '', label: 'Tenant timezone (default)' });
    expect(options.map((option) => option.value)).toEqual(['', 'America/New_York', 'UTC', 'Mars/Olympus']);
    expect(options[1].label).toBe('America/New York');
  });
});
