import { describe, expect, it } from 'vitest';
import {
  registerTicketListViewProvider, resolveTicketListViews, ticketListViewPredicates, type TicketListViewDefinition,
} from './ticketListViews';

const view = (key: string, clauses: TicketListViewDefinition['clauses'] = []): TicketListViewDefinition =>
  ({ key, labelKey: `k.${key}`, defaultLabel: key, clauses });

describe('ticket list views seam', () => {
  it('resolves nothing, without reading anything, when no provider recognises the subject', async () => {
    registerTicketListViewProvider('t-none', () => null);
    expect(await resolveTicketListViews({ tenant: 't', subject: {} })).toEqual([]);
  });

  it('returns the views of the first provider that recognises the subject', async () => {
    registerTicketListViewProvider('t-some', async () => [view('a')]);
    expect((await resolveTicketListViews({ tenant: 't', subject: {} })).map((v) => v.key)).toEqual(['a']);
  });

  it('selects the clauses of the named view and nothing for a key it was not offered', () => {
    const clause = { path: 'assigned_to', operator: 'is_empty' as const };
    const views = [view('unassigned', [clause]), view('all')];
    expect(ticketListViewPredicates(views, 'unassigned')).toEqual([clause]);
    expect(ticketListViewPredicates(views, 'all')).toEqual([]);
    expect(ticketListViewPredicates(views, 'bogus')).toEqual([]);
    expect(ticketListViewPredicates(views, undefined)).toEqual([]);
    expect(ticketListViewPredicates([], 'unassigned')).toEqual([]);
  });
});
