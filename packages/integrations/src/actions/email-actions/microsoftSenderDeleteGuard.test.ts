import { describe, expect, it } from 'vitest';
import { getMicrosoftSenderDeleteBlockMessage } from './microsoftSenderDeleteGuard';

describe('Microsoft mailbox sender delete guard', () => {
  it('returns the named action error message when a sender is linked', () => {
    expect(getMicrosoftSenderDeleteBlockMessage('projects@example.test')).toBe(
      'Cannot delete this Microsoft mailbox while sender projects@example.test uses it. Reassign or delete that sender first.'
    );
  });

  it('allows mailbox deletion when no sender is linked', () => {
    expect(getMicrosoftSenderDeleteBlockMessage(null)).toBeNull();
  });
});
