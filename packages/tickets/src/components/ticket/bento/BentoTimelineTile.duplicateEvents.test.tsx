// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({ default: () => () => null }));

import type { TicketTimelineEntry } from '@alga-psa/shared/lib/ticketActivity';
import { describeSystemEntry } from './BentoTimelineTile';

// Interpolating translator: real i18next semantics for {{var}}, English fallbacks.
const t = (_key: string, fallback: string, vars?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars?.[k] ?? ''));

const entry = (event_type: string, details?: Record<string, unknown>) =>
  ({
    activity: { event_type, actor_display_name: 'Dorothy', details, changes: {} },
  }) as unknown as TicketTimelineEntry;

describe('describeSystemEntry duplicate events', () => {
  it('names the source ticket on TICKET_DUPLICATED_FROM', () => {
    expect(describeSystemEntry(entry('TICKET_DUPLICATED_FROM', { source_ticket_number: 'T-1042' }), t))
      .toBe('Dorothy created this ticket as a duplicate of #T-1042');
  });

  it('names the new ticket on TICKET_DUPLICATED_TO', () => {
    expect(describeSystemEntry(entry('TICKET_DUPLICATED_TO', { duplicate_ticket_number: 'T-1043' }), t))
      .toBe('Dorothy duplicated this ticket as #T-1043');
  });

  it.each([
    ['TICKET_DUPLICATED_FROM', undefined],
    ['TICKET_DUPLICATED_FROM', { source_ticket_number: '' }],
    ['TICKET_DUPLICATED_FROM', { source_ticket_number: '  ' }],
    ['TICKET_DUPLICATED_TO', {}],
    ['TICKET_DUPLICATED_TO', { duplicate_ticket_number: null }],
  ])('falls back to the generic label for %s with %j', (type, details) => {
    const text = describeSystemEntry(entry(type, details as Record<string, unknown> | undefined), t);
    expect(text).not.toContain('#');
    expect(text).toContain('Dorothy');
  });
});
