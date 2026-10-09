import { describe, expect, it } from 'vitest';
import {
  buildPaletteSearchIndex,
  groupPaletteItemsByCategory,
  matchesPaletteSearchQuery,
  rankPaletteSearchResults,
  scorePaletteSearchMatch,
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

  it('matches synonyms of query words, so "note" finds comment actions and "notify" finds alerts', () => {
    const commentIndex = buildPaletteSearchIndex(['Add Ticket Comment', 'tickets.add_comment', 'ticket_id body visibility']);
    const alertIndex = buildPaletteSearchIndex(['Send In-App Notification', 'notifications.send_in_app']);

    expect(matchesPaletteSearchQuery(commentIndex, 'note')).toBe(true);
    expect(matchesPaletteSearchQuery(commentIndex, 'add note')).toBe(true);
    expect(matchesPaletteSearchQuery(commentIndex, 'internal notes')).toBe(false);
    expect(matchesPaletteSearchQuery(alertIndex, 'alert')).toBe(true);
    expect(matchesPaletteSearchQuery(alertIndex, 'notify')).toBe(true);
    expect(matchesPaletteSearchQuery(alertIndex, 'note')).toBe(false);
  });

  describe('ranking', () => {
    const action = (id: string, label: string, fieldNames: string[] = [], description = '') => ({
      id,
      searchFields: { label, aliases: [id], description: [description], keywords: fieldNames },
    });
    const catalog = [
      action('tickets.add_attachment', 'Add Ticket Attachment', ['ticket_id', 'comment']),
      action('scheduling.assign_user', 'Assign User (Schedule Entry)', ['entry_id', 'comment']),
      action('crm.create_quote', 'Create Quote', ['client_id', 'notes', 'comment']),
      action('time.find_entries', 'Find Time Entries', ['comment', 'ticket_id']),
      action('time.find_billing_blockers', 'Find Time Billing Blockers', ['ticket', 'ticket_id']),
      action('crm.find_activities', 'Find CRM Activities', ['ticket_id']),
      action('tickets.add_comment', 'Add Ticket Comment', ['ticket_id', 'body']),
      action('tickets.find', 'Find Ticket', ['ticket_id', 'priority_name']),
      action('tickets.find_attachments', 'Find Ticket Attachments', ['ticket_id']),
    ];
    const ranked = (query: string) => rankPaletteSearchResults(catalog, query).map((item) => item.id);

    it('finds Increment Stored Number for counter words', () => {
      const withIncrement = [...catalog, action('store.increment', 'Increment Stored Number', ['namespace', 'key', 'by'])];
      for (const query of ['counter', 'tally', 'increment']) {
        expect(rankPaletteSearchResults(withIncrement, query).map((item) => item.id)[0]).toBe('store.increment');
      }
    });

    it('puts an action named with the search word first, ahead of field-name matches', () => {
      expect(ranked('comment')[0]).toBe('tickets.add_comment');
      expect(ranked('comment').indexOf('crm.create_quote')).toBeGreaterThan(0);
    });

    it('puts an exact name first, then longer names that contain it', () => {
      expect(ranked('find ticket').slice(0, 2)).toEqual(['tickets.find', 'tickets.find_attachments']);
    });

    it('matches a partly typed last word in the name', () => {
      expect(ranked('add ticket com')[0]).toBe('tickets.add_comment');
    });

    it('uses synonyms on names, but not on field names', () => {
      expect(ranked('note')[0]).toBe('tickets.add_comment');
      // Create Quote has a "notes" field, which is the word itself (not a synonym), so it still matches.
      expect(scorePaletteSearchMatch(catalog[2].searchFields, 'note')).not.toBeNull();
      expect(scorePaletteSearchMatch({ label: 'Create Quote', keywords: ['remark'] }, 'note')).toBeNull();
    });

    it('finds Send Email for "email engineer", "email technician", "email assignee" and "email resource"', () => {
      const withEmail = [
        ...catalog,
        action('email.send', 'Send Email', ['to', 'users', 'ticket_id', 'subject'], "Send an email to addresses, users, roles, or a ticket's assigned technicians"),
        action('notifications.send_in_app', 'Send In-App Notification', ['recipients', 'title', 'body']),
      ];
      for (const query of ['email engineer', 'email technician', 'email assignee', 'email resource']) {
        const top = rankPaletteSearchResults(withEmail, query).map((item) => item.id).slice(0, 3);
        expect(top, query).toContain('email.send');
      }
    });

    it('ranks by tier: exact > prefix > words > ids > description > fields', () => {
      const score = (label: string, query: string, extra: Partial<Parameters<typeof scorePaletteSearchMatch>[0]> = {}) =>
        scorePaletteSearchMatch({ label, ...extra }, query) ?? -1;
      expect(score('Find Ticket', 'find ticket')).toBeGreaterThan(score('Find Ticket Attachments', 'find ticket'));
      expect(score('Find Ticket Attachments', 'find ticket')).toBeGreaterThan(score('Ticket Find', 'find ticket'));
      expect(score('Ticket Find', 'find ticket')).toBeGreaterThan(score('Lookup', 'find ticket', { aliases: ['tickets.find'] }));
      expect(score('Lookup', 'find ticket', { aliases: ['tickets.find'] }))
        .toBeGreaterThan(score('Lookup', 'find ticket', { description: ['Find a ticket'] }));
      expect(score('Lookup', 'find ticket', { description: ['Find a ticket'] }))
        .toBeGreaterThan(score('Lookup', 'find ticket', { keywords: ['find', 'ticket'] }));
      expect(score('Lookup', 'find ticket')).toBe(-1);
    });

    it('ranks business actions above generic transforms that match as well', () => {
      const items = [
        { id: 'transform.assign', category: 'Transform', searchFields: { label: 'Set variables', aliases: ['transform.assign'] } },
        { id: 'transform:pick', tileKind: 'transform', category: 'Actions', searchFields: { label: 'Assign Fields' } },
        { id: 'tickets.assign', tileKind: 'core-object', category: 'Actions', searchFields: { label: 'Assign Ticket To Team' } },
      ];
      expect(rankPaletteSearchResults(items, 'assign').map((item) => item.id)).toEqual([
        'tickets.assign',
        'transform:pick',
        'transform.assign',
      ]);
      // A better match tier still wins over the business/transform tiebreak.
      expect(rankPaletteSearchResults(items, 'assign fields').map((item) => item.id)[0]).toBe('transform:pick');
    });
  });
});
