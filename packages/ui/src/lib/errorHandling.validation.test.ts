import { describe, expect, it } from 'vitest';

import {
  CodedError,
  actionErrorFromValidationIssue,
  isPermissionError,
} from './errorHandling';

describe('actionErrorFromValidationIssue', () => {
  it('maps built-in issues by stable code instead of English prose', () => {
    expect(actionErrorFromValidationIssue({
      code: 'invalid_type',
      path: ['profile', 'name'],
      received: 'undefined',
      message: 'Required',
    })).toEqual({
      actionError: 'profile.name is required.',
      messageKey: 'common:errors.validation.required',
      messageParams: { field: 'profile.name' },
    });
  });

  it('preserves the explicit key and params carried by a custom issue', () => {
    expect(actionErrorFromValidationIssue({
      code: 'custom',
      message: 'Unknown timezone: Mars/Olympus',
      params: {
        messageKey: 'msp/integrations:errors.rmm.validation.unknownTimezone',
        messageParams: { timezone: 'Mars/Olympus' },
      },
    })).toEqual({
      actionError: 'Unknown timezone: Mars/Olympus',
      messageKey: 'msp/integrations:errors.rmm.validation.unknownTimezone',
      messageParams: { timezone: 'Mars/Olympus' },
    });
  });

  it('uses localized generic copy for keyless custom issues', () => {
    expect(actionErrorFromValidationIssue({
      code: 'custom',
      path: ['slug'],
      message: 'English-only schema prose',
    })).toEqual({
      actionError: 'slug has an invalid value.',
      messageKey: 'common:errors.validation.invalidValue',
      messageParams: { field: 'slug' },
    });
  });
});

describe('isPermissionError', () => {
  it('uses payload shape or an explicit code, never English prose', () => {
    expect(isPermissionError({ permissionError: 'Zugriff verweigert' })).toBe(true);
    expect(isPermissionError(new CodedError('localized or internal copy', 'PERMISSION_DENIED'))).toBe(true);
    expect(isPermissionError(new Error('Permission denied: English prose'))).toBe(false);
    expect(isPermissionError('Permission denied: English prose')).toBe(false);
  });
});
