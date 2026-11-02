import { describe, expect, it } from 'vitest';
import { countAuthorizedTicketChanges, summarizeTicketActivityHistory } from './ticketChangeCounts';

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
  it('keeps other-board history across refreshes without counting it in the new list window', () => {
    const result = countAuthorizedTicketChanges({
      candidates: [
        { ticket_id: 'earlier-board-y', board_id: 'board-y', activityActors: ['other'], latestActivityAt: '2026-11-02T12:00:00Z' },
        { ticket_id: 'current-board-x', board_id: 'board-x', activityActors: ['other'], latestActivityAt: '2026-11-02T12:02:00Z' },
      ],
      matchingTicketIds: new Set(['earlier-board-y', 'current-board-x']), loadedTicketIds: new Set(),
      currentUserId: 'me', since: Date.parse('2026-11-02T12:01:00Z'),
    });
    expect(result.newCount).toBe(1);
    expect(result.boards).toEqual({ 'board-x': 1, 'board-y': 1 });
  });

  it('retains another user’s missed edit when the viewer edits the same ticket later', () => {
    const history = summarizeTicketActivityHistory({
      entries: [
        { actorUserId: 'other-agent', occurredAt: '2026-11-02T12:01:00Z' },
        { actorUserId: 'viewer', occurredAt: '2026-11-02T12:02:00Z' },
      ],
      currentUserId: 'viewer',
      listSince: Date.parse('2026-11-02T12:00:00Z'),
    });
    const result = countAuthorizedTicketChanges({
      candidates: [{ ticket_id: 'loaded', board_id: 'board-a', ...history }],
      matchingTicketIds: new Set(), loadedTicketIds: new Set(['loaded']), currentUserId: 'viewer',
      since: Date.parse('2026-11-02T12:00:00Z'),
    });

    expect(result).toEqual({ newCount: 0, updatedCount: 1, boards: { 'board-a': 1 }, boardLatestAt: { 'board-a': '2026-11-02T12:01:00.000Z' } });
  });

  it('excludes activity history containing only viewer edits', () => {
    const history = summarizeTicketActivityHistory({
      entries: [{ actorUserId: 'viewer', occurredAt: '2026-11-02T12:01:00Z' }],
      currentUserId: 'viewer', listSince: Date.parse('2026-11-02T12:00:00Z'),
    });
    const result = countAuthorizedTicketChanges({
      candidates: [{ ticket_id: 'own-only', board_id: 'board-a', ...history }],
      matchingTicketIds: new Set(['own-only']), loadedTicketIds: new Set(), currentUserId: 'viewer',
      since: Date.parse('2026-11-02T12:00:00Z'),
    });

    expect(result).toEqual({ newCount: 0, updatedCount: 0, boards: {}, boardLatestAt: {} });
  });

});
