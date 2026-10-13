import { describe, expect, it } from 'vitest';
import {
  BOARD_NOTIFICATION_EMAIL_MAX_LENGTH,
  normalizeBoardNotificationEmail,
} from '@alga-psa/shared/lib/tickets/boardNotificationRules';

describe('normalizeBoardNotificationEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeBoardNotificationEmail('  Queue-DL@MSP.Test ')).toBe('queue-dl@msp.test');
  });

  it('strips display names and mailto:', () => {
    expect(normalizeBoardNotificationEmail('"Queue DL" <Queue-DL@msp.test>')).toBe('queue-dl@msp.test');
    expect(normalizeBoardNotificationEmail('mailto:Queue-DL@msp.test')).toBe('queue-dl@msp.test');
  });

  it('accepts an address at the length cap and rejects one over it', () => {
    const domain = '@msp.test';
    const atCap = 'a'.repeat(BOARD_NOTIFICATION_EMAIL_MAX_LENGTH - domain.length) + domain;
    expect(atCap).toHaveLength(BOARD_NOTIFICATION_EMAIL_MAX_LENGTH);
    expect(normalizeBoardNotificationEmail(atCap)).toBe(atCap);
    expect(normalizeBoardNotificationEmail('a' + atCap)).toBeNull();
  });

  it.each([null, undefined, '', '   ', 'no-at-sign', '@msp.test', 'user@', 'plain words'])(
    'rejects invalid input %j',
    (value) => {
      expect(normalizeBoardNotificationEmail(value as string | null | undefined)).toBeNull();
    }
  );
});
