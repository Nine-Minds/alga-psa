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
    'Create Ticket tickets.create client_id ticket_id ticket_number requester_email',
  ]);
  const contactSearchIndex = buildPaletteSearchIndex([
    'contact',
    'Contact',
    'Find and update contacts linked to workflow data.',
    'Find Contact contacts.find contact_id full_name email',
  ]);
  const transformSearchIndex = buildPaletteSearchIndex([
    'transform',
    'Transform',
    'Shape and normalize workflow data without raw expressions.',
    'Truncate Text transform.truncate_text text maxLength',
  ]);
  const appSearchIndex = buildPaletteSearchIndex([
    'app:slack',
    'Slack',
    'Send messages to Slack.',
    'Send Slack Message slack.send_message channel message',
  ]);
  const controlSearchIndex = buildPaletteSearchIndex([
    'control.callWorkflow',
    'Call Workflow',
    'Invoke another workflow.',
  ]);

  it('T041/T042/T043/T044/T305: matches grouped tiles by contained action labels, action ids, and input/output field names', () => {
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'Create Ticket')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'tickets.create')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'client id')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'ticket id')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'ticket number')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'requester email')).toBe(true);
  });

  it('T045/T046: matches grouped tiles by label and description using normalized phrases', () => {
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'Ticket')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'manage tickets')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'create-ticket')).toBe(true);
  });

  it('T048/T057/T058: matches grouped contact/ticket tiles by singular or plural object names and verb-object phrases', () => {
    expect(matchesPaletteSearchQuery(contactSearchIndex, 'find contact')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'ticket')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'tickets')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'assign ticket')).toBe(true);
    expect(matchesPaletteSearchQuery(ticketSearchIndex, 'find-contact')).toBe(false);
  });

  it('T049/T229/T306: matches transform tiles by contained action phrases such as truncate-text', () => {
    expect(matchesPaletteSearchQuery(transformSearchIndex, 'truncate-text')).toBe(true);
    expect(matchesPaletteSearchQuery(transformSearchIndex, 'transform truncate')).toBe(true);
  });

  it('T050/T053/T056: keeps control blocks, app tiles, and legacy individually rendered nodes searchable', () => {
    expect(matchesPaletteSearchQuery(controlSearchIndex, 'call workflow')).toBe(true);
    expect(matchesPaletteSearchQuery(controlSearchIndex, 'control.callWorkflow')).toBe(true);
    expect(matchesPaletteSearchQuery(appSearchIndex, 'send slack message')).toBe(true);
    expect(matchesPaletteSearchQuery(appSearchIndex, 'slack.send_message')).toBe(true);
  });

  it('T047/T059: grouped search results return a matching grouped tile once instead of duplicating it per contained action', () => {
    const grouped = groupPaletteItemsByCategory([
      { id: 'ticket', category: 'Core', label: 'Ticket', sortOrder: 1 },
      { id: 'control.callWorkflow', category: 'Control', label: 'Call Workflow', sortOrder: 1 },
    ]);

    const matchingCoreIds = grouped.Core
      .filter(() => matchesPaletteSearchQuery(ticketSearchIndex, 'create ticket'))
      .map((item) => item.id);

    expect(matchingCoreIds).toEqual(['ticket']);
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
