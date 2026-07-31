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

describe('searchRegistryEntries (T003 — alga0001973 registry gaps)', () => {
  // Mirrors the real registry: the create-ticket endpoint is tagged "Work
  // Management v1" (no "ticket" token), while "Create ticket category" is tagged
  // "Ticket Categories" and its path ends in "ticket" — so it used to win a bare
  // "create ticket" search on a +2.5 tag match it did not deserve.
  const TICKET_VS_CATEGORY: ChatApiRegistryEntry[] = [
    entry({
      id: 'categories.ticket.create',
      method: 'post',
      path: '/api/v1/categories/ticket',
      displayName: 'Create ticket category',
      summary: 'Create ticket category',
      description: 'Creates a ticket category row for one board.',
      tags: ['Ticket Categories'],
      requestBodySchema: { type: 'object', properties: { category_name: { type: 'string' } } },
    }),
    entry({
      id: 'tickets.create',
      method: 'post',
      path: '/api/v1/tickets',
      displayName: 'Create Ticket',
      summary: 'Create a new ticket',
      description: 'Creates a new ticket on a specified board with the desired status and priority.',
      tags: ['Work Management v1'],
      requestBodySchema: { type: 'object', properties: { title: { type: 'string' } } },
    }),
  ];

  it('ranks Create Ticket above Create ticket category for "create ticket"', () => {
    const top = searchRegistryEntries(TICKET_VS_CATEGORY, 'create ticket')[0];
    expect(top.entry.id).toBe('tickets.create');
  });

  it('still ranks Create ticket category first when the query names the category', () => {
    const top = searchRegistryEntries(TICKET_VS_CATEGORY, 'create ticket category')[0];
    expect(top.entry.id).toBe('categories.ticket.create');
  });

  // Mirrors the real registry: List Tickets mentions "priority" in its description
  // and filter params, so it used to outrank the dedicated List priorities endpoint —
  // whose own name ("priorities") never matched the singularized "priority" token.
  const PRIORITY_LOOKUP: ChatApiRegistryEntry[] = [
    entry({
      id: 'tickets.list',
      method: 'get',
      path: '/api/v1/tickets',
      displayName: 'List Tickets',
      summary: 'List tickets',
      description:
        'Returns a paginated list of tickets. Supports filtering by board, status, priority, client. Use GET /api/v1/priorities for lookup data.',
      tags: ['Work Management v1'],
      parameters: [
        {
          name: 'priority_id',
          in: 'query',
          required: false,
          description: 'Filter by ticket priority UUID. Call GET /api/v1/priorities to discover priority UUIDs.',
        },
        { name: 'priority_name', in: 'query', required: false, description: 'Filter by priority display name.' },
      ],
    }),
    entry({
      id: 'priorities.list',
      method: 'get',
      path: '/api/v1/priorities',
      displayName: 'List priorities',
      summary: 'List priorities',
      description: 'Lists ticket priorities for the tenant with pagination and sorting.',
      tags: ['Priorities'],
    }),
  ];

  it('ranks List priorities first for "list priorities"', () => {
    const top = searchRegistryEntries(PRIORITY_LOOKUP, 'list priorities')[0];
    expect(top.entry.id).toBe('priorities.list');
  });

  it('ranks List priorities first for the bare query "priorities"', () => {
    const top = searchRegistryEntries(PRIORITY_LOOKUP, 'priorities')[0];
    expect(top.entry.id).toBe('priorities.list');
  });

  it('matches a resource endpoint when the query uses the plural form', () => {
    const registry: ChatApiRegistryEntry[] = [
      entry({ id: 'tickets.list', method: 'get', path: '/api/v1/tickets', displayName: 'List Tickets', tags: ['Tickets'] }),
      entry({ id: 'categories.list', method: 'get', path: '/api/v1/categories', displayName: 'List Categories', tags: ['Categories'] }),
    ];
    const top = searchRegistryEntries(registry, 'categories')[0];
    expect(top.entry.id).toBe('categories.list');
  });
});
