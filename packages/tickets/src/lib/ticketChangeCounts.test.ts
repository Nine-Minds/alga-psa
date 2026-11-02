import { describe, expect, it } from 'vitest';
import { countAuthorizedTicketChanges } from './ticketChangeCounts';

describe('authorized ticket change recovery counts', () => {
  it('returns distinct counts only for changed readable records and preserves cross-board totals', () => {
    const result = countAuthorizedTicketChanges({
      candidates: [
        { ticket_id: 'loaded', board_id: 'board-x', updated_by: 'other' },
        { ticket_id: 'new-y', board_id: 'board-y', updated_by: 'other' },
        { ticket_id: 'new-y', board_id: 'board-y', updated_by: 'other' },
        { ticket_id: 'own', board_id: 'board-z', updated_by: 'me' },
        { ticket_id: 'not-matching', board_id: 'board-z', updated_by: 'other' },
      ],
      matchingTicketIds: new Set(['new-y']),
      loadedTicketIds: new Set(['loaded']),
      currentUserId: 'me',
    });
    expect(result).toEqual({ newCount: 1, updatedCount: 1, boards: { 'board-x': 1, 'board-y': 1, 'board-z': 1 }, boardLatestAt: {} });
  });

  it('uses individual ticket and comment actors so email-only comments survive an unchanged ticket timestamp', () => {
    const result = countAuthorizedTicketChanges({
      candidates: [
        { ticket_id: 'email-reply', board_id: 'board-mail', updated_by: 'me', activityActors: ['other-agent'], latestActivityAt: '2026-11-02T12:00:00Z' },
        { ticket_id: 'own-comment', board_id: 'board-mail', updated_by: 'other-agent', activityActors: ['me'] },
      ],
      matchingTicketIds: new Set(['email-reply', 'own-comment']),
      loadedTicketIds: new Set(),
      currentUserId: 'me',
    });
    expect(result).toEqual({ newCount: 1, updatedCount: 0, boards: { 'board-mail': 1 }, boardLatestAt: { 'board-mail': '2026-11-02T12:00:00Z' } });
  });
});
