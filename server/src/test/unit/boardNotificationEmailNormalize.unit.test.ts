import { isValidEmail } from '@alga-psa/core';
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

  it.each([null, undefined, '', '   ', 'no-at-sign', '@msp.test', 'user@', 'plain words', 'a@b', 'user@localhost', 'a@@b.test', 'a..b@msp.test'])(
    'rejects invalid input %j',
    (value) => {
      expect(normalizeBoardNotificationEmail(value as string | null | undefined)).toBeNull();
    }
  );

  it('agrees with the send-path validator (isValidEmail) on every input', () => {
    const tooLong = 'a'.repeat(250) + '@msp.test';
    const inputs = [
      'queue-dl@msp.test',
      'Queue-DL@MSP.Test',
      '"Queue DL" <queue-dl@msp.test>',
      'Queue DL <queue-dl@msp.test>',
      'mailto:queue-dl@msp.test',
      'a@b',
      'user@localhost',
      'user@msp',
      'a..b@msp.test',
      'a@msp..test',
      'plain words',
      tooLong,
    ];
    for (const input of inputs) {
      const normalized = normalizeBoardNotificationEmail(input);
      if (normalized !== null) {
        // Anything the save path accepts must survive the send-path filter.
        expect(isValidEmail(normalized), input).toBe(true);
      }
    }
    expect(normalizeBoardNotificationEmail(tooLong)).toBeNull();
    expect(normalizeBoardNotificationEmail('Queue DL <queue-dl@msp.test>')).toBe('queue-dl@msp.test');
  });
});
