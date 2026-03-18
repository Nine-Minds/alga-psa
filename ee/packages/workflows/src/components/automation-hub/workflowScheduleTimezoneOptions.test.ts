import { describe, expect, it } from 'vitest';

import {
  COMMON_IANA_TIMEZONES,
  inferWorkflowScheduleTimezoneMode,
} from './workflowScheduleTimezoneOptions';

describe('workflowScheduleTimezoneOptions', () => {
  const commonTimezones = COMMON_IANA_TIMEZONES.slice(0, 3);
  const supportedTimezones = [...commonTimezones, 'Europe/Madrid'];

  it('marks common timezones as common mode', () => {
    expect(
      inferWorkflowScheduleTimezoneMode('UTC', commonTimezones, supportedTimezones)
    ).toBe('common');
  });

  it('marks supported non-common timezones as browse mode', () => {
    expect(
      inferWorkflowScheduleTimezoneMode('Europe/Madrid', commonTimezones, supportedTimezones)
    ).toBe('browse');
  });

  it('marks unsupported values as custom mode', () => {
    expect(
      inferWorkflowScheduleTimezoneMode('Mars/Base', commonTimezones, supportedTimezones)
    ).toBe('custom');
  });
});
