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

  it('T186/T188: falls back safely to my-work when Teams passes an unsupported page or invalid context payload', () => {
    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'unsupported', ticketId: 'ticket-123' }),
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(
      resolveTeamsTabDestination({
        context: '{not-json',
      })
    ).toEqual({
      type: 'my_work',
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
