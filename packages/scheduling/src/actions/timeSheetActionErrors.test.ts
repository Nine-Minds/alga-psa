import { describe, expect, it } from 'vitest';
import { timeSheetActionErrorFrom } from './timeSheetActionErrors';

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
});
