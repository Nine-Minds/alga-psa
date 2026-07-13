import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { classifyOpportunityDiscipline } from '../src/lib/disciplineEngine';

const NOW = Temporal.Instant.from('2026-07-22T12:00:00.000Z');

function classify(overrides: Record<string, unknown> = {}) {
  return classifyOpportunityDiscipline({
    lastActivityAt: '2026-07-07T12:00:00.000Z',
    nextActionDue: '2026-07-21T12:00:00.000Z',
    lastNudgedAt: null,
    lastEscalatedAt: null,
    overdueNotifiedAt: null,
    nudgeDays: 14,
    interruptDays: 21,
    escalationMode: 'solo',
    now: NOW,
    ...overrides,
  } as any);
}

describe('opportunity discipline episodes', () => {
  it('nudges and emits overdue only once until new activity or a new due date starts an episode', () => {
    expect(classify()).toMatchObject({ nudge: true, escalate: false, overdue: true });

    expect(classify({
      lastNudgedAt: '2026-07-22T12:00:00.000Z',
      overdueNotifiedAt: '2026-07-22T12:00:00.000Z',
    })).toMatchObject({ nudge: false, overdue: false });

    expect(classify({
      lastActivityAt: '2026-07-23T12:00:00.000Z',
      lastNudgedAt: '2026-07-22T12:00:00.000Z',
      nextActionDue: '2026-07-24T12:00:00.000Z',
      overdueNotifiedAt: '2026-07-22T12:00:00.000Z',
      now: Temporal.Instant.from('2026-08-08T12:00:00.000Z'),
    })).toMatchObject({ nudge: true, overdue: true });
  });

  it('selects solo calendar interruption or team notification escalation at the interrupt threshold', () => {
    expect(classify({ lastActivityAt: '2026-06-30T12:00:00.000Z' }))
      .toMatchObject({ escalate: true, escalationMode: 'solo' });
    expect(classify({
      lastActivityAt: '2026-06-30T12:00:00.000Z',
      escalationMode: 'team',
    })).toMatchObject({ escalate: true, escalationMode: 'team' });

    expect(classify({
      lastActivityAt: '2026-06-30T12:00:00.000Z',
      lastEscalatedAt: '2026-07-22T12:00:00.000Z',
    })).toMatchObject({ escalate: false });
  });
});
