export const BROWSE_ALL_VALUE = '__browse_all__';
export const CUSTOM_VALUE = '__custom__';

export const COMMON_IANA_TIMEZONES: string[] = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
];

export type WorkflowScheduleTimezoneMode = 'common' | 'browse' | 'custom';

export const getSupportedTimezones = (): string[] => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [...COMMON_IANA_TIMEZONES];
  }
};

export const inferWorkflowScheduleTimezoneMode = (
  value: string,
  commonTimezones: string[],
  supportedTimezones: string[]
): WorkflowScheduleTimezoneMode => {
  if (commonTimezones.includes(value)) {
    return 'common';
  }
  if (supportedTimezones.includes(value)) {
    return 'browse';
  }
  return 'custom';
};
