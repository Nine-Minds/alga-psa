import { describe, expect, it } from 'vitest';
import { timeSheetActionErrorFrom } from './timeSheetActionErrors';
import {
  BUCKET_USAGE_ERROR_MESSAGES,
  BucketUsageError,
  type BucketUsageErrorCode,
} from '@alga-psa/shared/billingClients/bucketUsageErrors';

describe('timeSheetActionErrorFrom', () => {
  it('maps expected permission, not-found, and workflow-state failures to action results', () => {
    expect(timeSheetActionErrorFrom(new Error('Permission denied: Cannot approve timesheets'))).toEqual({
      permissionError: 'Permission denied: Cannot approve timesheets',
    });

    expect(timeSheetActionErrorFrom(new Error('Time sheet not found'))).toEqual({
      actionError: 'Time sheet not found. It may have been deleted. Please refresh and try again.',
    });

    expect(timeSheetActionErrorFrom(new Error('Time sheet is not in an approved state'))).toEqual({
      actionError: 'Only approved time sheets can be reopened.',
    });
  });

  it('leaves unexpected failures unhandled', () => {
    expect(timeSheetActionErrorFrom(new Error('database connection lost'))).toBeNull();
  });

  describe('bucket usage failures', () => {
    // Regression: alga0002175. These causes are unrelated and need different
    // actions from the user, but all used to surface as the single sentence
    // "Unable to update bucket usage for this time entry."
    const codes: BucketUsageErrorCode[] = [
      'NO_ACTIVE_CONTRACT_LINE',
      'AMBIGUOUS_ASSIGNMENT',
      'MISSING_PLAN_SERVICE_CONFIG',
      'MISSING_BUCKET_CONFIG',
      'UNSUPPORTED_BILLING_FREQUENCY',
    ];

    it.each(codes)('maps %s to its own message', (code) => {
      const result = timeSheetActionErrorFrom(
        new BucketUsageError(code, 'internal detail that must not reach the user'),
      );

      expect(result).toEqual({ actionError: BUCKET_USAGE_ERROR_MESSAGES[code] });
    });

    it('gives each code a distinct message', () => {
      const messages = codes.map((code) => BUCKET_USAGE_ERROR_MESSAGES[code]);
      expect(new Set(messages).size).toBe(messages.length);
    });

    it('never leaks the internal message to the user', () => {
      const result = timeSheetActionErrorFrom(
        new BucketUsageError('MISSING_BUCKET_CONFIG', 'config_id abc-123 in tenant xyz'),
      );

      expect(JSON.stringify(result)).not.toContain('abc-123');
    });

    it('recovers the code when the failure was wrapped on its way up', () => {
      const wrapped = new Error('Bucket usage update failed for time entry entry-1', {
        cause: new BucketUsageError('AMBIGUOUS_ASSIGNMENT', 'two assignments matched'),
      });

      expect(timeSheetActionErrorFrom(wrapped)).toEqual({
        actionError: BUCKET_USAGE_ERROR_MESSAGES.AMBIGUOUS_ASSIGNMENT,
      });
    });

    it('still handles an unconverted bucket failure via the string fallback', () => {
      expect(
        timeSheetActionErrorFrom(new Error('Bucket usage update failed for time entry entry-1')),
      ).toEqual({
        actionError: 'Unable to update bucket usage for this time entry. Please refresh and try again.',
      });
    });
  });
});
