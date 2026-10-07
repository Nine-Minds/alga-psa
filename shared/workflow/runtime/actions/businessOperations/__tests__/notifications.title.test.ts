import { describe, expect, it } from 'vitest';
import { FALLBACK_IN_APP_TITLE, sanitizeInAppNotificationTitle } from '../notifications';

describe('sanitizeInAppNotificationTitle', () => {
  it('keeps a healthy title untouched', () => {
    expect(sanitizeInAppNotificationTitle('New ticket from ada@example.test')).toBe('New ticket from ada@example.test');
  });

  it('drops a dangling "from" left by an empty interpolation', () => {
    expect(sanitizeInAppNotificationTitle('New ticket from ')).toBe('New ticket');
    expect(sanitizeInAppNotificationTitle('New ticket from')).toBe('New ticket');
  });

  it('never lets a bare tenant or ticket UUID through as the title', () => {
    expect(sanitizeInAppNotificationTitle('3ca189ae-1111-4222-8333-444455556666')).toBe(FALLBACK_IN_APP_TITLE);
    expect(sanitizeInAppNotificationTitle('d410d992-4e99-43e7-9390-f6b0ff744509')).toBe(FALLBACK_IN_APP_TITLE);
    expect(sanitizeInAppNotificationTitle('  ')).toBe(FALLBACK_IN_APP_TITLE);
  });

  it('leaves legitimate titles that end in other short words alone', () => {
    for (const t of ['Time to sign on', 'Time to', 'Waiting on', 'Quote of', 'Ask about', 'Message to']) {
      expect(sanitizeInAppNotificationTitle(t)).toBe(t);
    }
  });
});
