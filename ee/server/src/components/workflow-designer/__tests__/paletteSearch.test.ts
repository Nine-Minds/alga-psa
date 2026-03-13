import { describe, expect, it } from 'vitest';
import {
  buildPaletteSearchIndex,
  groupPaletteItemsByCategory,
  matchesPaletteSearchQuery,
} from '../paletteSearch';

describe('workflow designer palette search helpers', () => {
  const ticketSearchIndex = buildPaletteSearchIndex([
    'ticket',
    'Ticket',
    'Create, find, update, assign, and manage tickets.',
    'Create Ticket tickets.create client_id ticket_id',
  ]);

  it('matches grouped tiles by contained action labels, action ids, and field names', () => {
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'Create Ticket')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'tickets.create')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'client id')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'ticket id')).toBe(true);
  });

  it('matches grouped tiles by label and description using normalized phrases', () => {
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'Ticket')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'manage tickets')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'create-ticket')).toBe(true);
  });

  it('matches grouped tiles by singular or plural object names and verb-object phrases', () => {
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'ticket')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'tickets')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'assign ticket')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'find-contact')).toBe(false);
  });

  it('T052: preserves stable grouped ordering when grouping palette results', () => {
    const grouped = groupPaletteItemsByCategory([
      { id: 'node-a', category: 'Nodes', label: 'Node A', sortOrder: 1 },
      { id: 'ticket', category: 'Core', label: 'Ticket', sortOrder: 1 },
      { id: 'control.if', category: 'Control', label: 'If', sortOrder: 2 },
      { id: 'transform', category: 'Transform', label: 'Transform', sortOrder: 1 },
      { id: 'control.forEach', category: 'Control', label: 'For Each', sortOrder: 1 },
      { id: 'app:slack', category: 'Apps', label: 'Slack', sortOrder: 1 },
    ]);

    expect(Object.keys(grouped)).toEqual(['Control', 'Core', 'Transform', 'Apps', 'Nodes']);
    expect(grouped.Control.map((item) => item.id)).toEqual(['control.forEach', 'control.if']);
    expect(grouped.Core.map((item) => item.id)).toEqual(['ticket']);
  });
});
