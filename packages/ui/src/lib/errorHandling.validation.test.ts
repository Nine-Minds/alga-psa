import { describe, expect, it } from 'vitest';

import { actionErrorFromValidationIssue } from './errorHandling';

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
