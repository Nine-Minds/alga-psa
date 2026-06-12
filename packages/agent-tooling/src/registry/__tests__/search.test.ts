import { describe, it, expect } from 'vitest';
import { searchRegistryEntries } from '../search';
import type { ChatApiRegistryEntry } from '../schema';

function entry(
  e: Partial<ChatApiRegistryEntry> &
    Pick<ChatApiRegistryEntry, 'id' | 'method' | 'path' | 'displayName'>,
): ChatApiRegistryEntry {
  return { tags: [], approvalRequired: false, parameters: [], ...e };
}

const REGISTRY: ChatApiRegistryEntry[] = [
  entry({ id: 'tickets.list', method: 'get', path: '/api/v1/tickets', displayName: 'List Tickets', tags: ['Tickets'] }),
  entry({
    id: 'tickets.get',
    method: 'get',
    path: '/api/v1/tickets/{id}',
    displayName: 'Get Ticket',
    tags: ['Tickets'],
    parameters: [{ name: 'id', in: 'path', required: true }],
  }),
  entry({
    id: 'tickets.create',
    method: 'post',
    path: '/api/v1/tickets',
    displayName: 'Create Ticket',
    tags: ['Tickets'],
    approvalRequired: true,
    requestBodySchema: { type: 'object', properties: { title: { type: 'string' } } },
  }),
  entry({ id: 'contacts.list', method: 'get', path: '/api/v1/contacts', displayName: 'List Contacts', tags: ['Contacts'] }),
];

describe('searchRegistryEntries (T001 — intent + resource ranking)', () => {
  it('ranks the POST endpoint first for a create intent', () => {
    const top = searchRegistryEntries(REGISTRY, 'create a ticket')[0];
    expect(top.entry.id).toBe('tickets.create');
  });

  it('ranks the by-id GET endpoint first for a detail intent', () => {
    const top = searchRegistryEntries(REGISTRY, 'get ticket by id')[0];
    expect(top.entry.id).toBe('tickets.get');
  });

  it('ranks the collection GET endpoint first for a list intent', () => {
    const top = searchRegistryEntries(REGISTRY, 'list tickets')[0];
    expect(top.entry.id).toBe('tickets.list');
  });

  it('returns an empty result for an empty query', () => {
    expect(searchRegistryEntries(REGISTRY, '   ')).toEqual([]);
  });
});

describe('searchRegistryEntries (T002 — relevant over irrelevant)', () => {
  it('ranks resource-matching entries above unrelated ones', () => {
    const results = searchRegistryEntries(REGISTRY, 'create a ticket');
    const ids = results.map((r) => r.entry.id);
    const contactsRank = ids.indexOf('contacts.list');
    const ticketCreateRank = ids.indexOf('tickets.create');
    expect(ticketCreateRank).toBeGreaterThanOrEqual(0);
    // contacts.list either absent or ranked below the ticket match
    expect(contactsRank === -1 || contactsRank > ticketCreateRank).toBe(true);
  });

  it('penalizes placeholder metadata even when index position favors it', () => {
    // Placeholder entry first (better recency bonus), clean entry second.
    const registry: ChatApiRegistryEntry[] = [
      entry({ id: 'beta', method: 'get', path: '/api/v1/beta', displayName: 'GET v1', summary: 'GET v1', tags: ['thing'] }),
      entry({ id: 'alpha', method: 'get', path: '/api/v1/alpha', displayName: 'List Alpha', tags: ['thing'] }),
    ];
    const top = searchRegistryEntries(registry, 'thing')[0];
    expect(top.entry.id).toBe('alpha');
  });
});
