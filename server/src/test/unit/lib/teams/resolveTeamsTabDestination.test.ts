import { describe, expect, it } from 'vitest';
import {
  describeTeamsTabDestination,
  resolveTeamsTabDestination,
} from 'server/src/lib/teams/resolveTeamsTabDestination';

describe('resolveTeamsTabDestination', () => {
  it('parses Teams deep-link context payloads into a destination model', () => {
    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'ticket', ticketId: 'ticket-123' }),
      })
    ).toEqual({
      type: 'ticket',
      ticketId: 'ticket-123',
    });
  });

  it('falls back to my-work when the Teams context is missing or incomplete', () => {
    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'ticket' }),
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(describeTeamsTabDestination({ type: 'my_work' })).toEqual({
      title: 'My work',
      summary: 'Your Teams personal tab is ready to load your PSA work queue.',
    });
  });
});
