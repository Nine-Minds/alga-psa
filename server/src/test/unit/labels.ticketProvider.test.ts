import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelRequestContext } from '@alga-psa/types';

const state = vi.hoisted(() => ({
  permitted: true,
  authorizationError: null as Error | null,
  row: null as Record<string, unknown> | null,
  rowsById: null as Record<string, Record<string, unknown>> | null,
  phones: [] as Array<{ contact_name_id: string; phone_number: string }>,
  selected: [] as string[],
  joins: [] as string[],
  phoneOrder: [] as Array<{ column: string; order: string }>,
  phoneQueries: 0,
  phoneContactIds: [] as string[],
  queries: 0,
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => state.permitted }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: (tableName: string) => {
      state.queries += 1;
      if (tableName === 'contact_phone_numbers') state.phoneQueries += 1;
      let ticketId: string | null = null;
      const query = {
        where: (_column: string, value: string) => {
          ticketId = value;
          return query;
        },
        whereIn: (_column: string, values: string[]) => {
          state.phoneContactIds = values;
          return query;
        },
        select: (...columns: string[]) => {
          state.selected.push(...columns);
          return query;
        },
        orderBy: (order: Array<{ column: string; order: string }>) => {
          if (tableName === 'contact_phone_numbers') state.phoneOrder = order;
          return query;
        },
        first: async () => (state.rowsById && ticketId ? state.rowsById[ticketId] : state.row),
        then: (resolve: (rows: unknown) => unknown) => resolve(state.phones),
      };
      return query;
    },
    tenantJoin: (_query: unknown, tableName: string) => {
      state.joins.push(tableName);
    },
  }),
}));
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: async () => {
    if (state.authorizationError) throw state.authorizationError;
  },
}));

import { ticketLabelViewModelProvider } from '@alga-psa/tickets/lib/labelViewModelProvider';

const context: LabelRequestContext = {
  tenant: 'tenant',
  user: { user_id: 'user' } as LabelRequestContext['user'],
  baseUrl: 'https://psa.example.com',
};
const worksheetContext = { ...context, includeWorksheetDetails: true };
const ticketId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  state.permitted = true;
  state.authorizationError = null;
  state.selected = [];
  state.joins = [];
  state.phones = [{ contact_name_id: 'contact-1', phone_number: '+1-206-555-0142' }];
  state.rowsById = null;
  state.phoneOrder = [];
  state.phoneQueries = 0;
  state.phoneContactIds = [];
  state.queries = 0;
  state.row = {
    ticket_id: ticketId,
    ticket_number: 'TIC-1',
    title: 'Broken laptop',
    contact_name_id: 'contact-1',
    client_name: 'Client',
    contact_name: 'Avery Johnson',
    contact_email: 'avery.johnson@example.com',
    category_name: 'Hardware',
    subcategory_name: 'Laptop',
    attributes: { description: 'First paragraph\nSecond paragraph' },
  };
});

describe('ticketLabelViewModelProvider worksheet details', () => {
  it.each([context, worksheetContext])('includes contact fields regardless of page-size mode', async (requestContext) => {
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(requestContext, [ticketId]);

    expect(result).toMatchObject({
      contactName: 'Avery Johnson',
      contactPhone: '+1-206-555-0142',
      contactEmail: 'avery.johnson@example.com',
    });
    expect(state.selected).toContain('t.contact_name_id');
    expect(state.joins).toContain('contacts as ct');
    expect(state.phoneOrder).toEqual([
      { column: 'contact_name_id', order: 'asc' },
      { column: 'is_default', order: 'desc' },
      { column: 'display_order', order: 'asc' },
    ]);
  });

  it('looks up contact phones for the whole batch in one query', async () => {
    const otherTicketId = '22222222-2222-4222-8222-222222222222';
    const noContactTicketId = '33333333-3333-4333-8333-333333333333';
    state.rowsById = {
      [ticketId]: { ...state.row!, contact_name_id: 'contact-1' },
      [otherTicketId]: { ...state.row!, ticket_id: otherTicketId, contact_name_id: 'contact-2' },
      [noContactTicketId]: { ...state.row!, ticket_id: noContactTicketId, contact_name_id: null },
    };
    state.phones = [
      { contact_name_id: 'contact-1', phone_number: 'default-1' },
      { contact_name_id: 'contact-1', phone_number: 'second-1' },
      { contact_name_id: 'contact-2', phone_number: 'default-2' },
    ];

    const results = await ticketLabelViewModelProvider.getLabelViewModels(context, [
      ticketId,
      otherTicketId,
      noContactTicketId,
    ]);

    expect(state.phoneQueries).toBe(1);
    expect(state.phoneContactIds).toEqual(['contact-1', 'contact-2']);
    expect(results.map((result) => result?.contactPhone)).toEqual(['default-1', 'default-2', null]);
  });

  it('does not read or return a description for ordinary tags', async () => {
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(context, [ticketId]);
    expect(state.selected).not.toContain('t.attributes');
    expect(result).not.toHaveProperty('ticketDescription');
    expect(result).not.toHaveProperty('ticketDescriptionRichText');
    expect(result?.detail).toBe('Laptop');
  });

  it('preserves legacy plain text and does not apply the 160-character summary limit', async () => {
    const description = `${'A'.repeat(200)}\nSecond paragraph`;
    state.row!.attributes = { description };
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(worksheetContext, [ticketId]);
    expect(state.selected).toContain('t.attributes');
    expect(result?.ticketDescription).toBe(description);
    expect(result?.ticketDescriptionRichText).toBe(description);
    expect(result?.detail).toBe('Laptop');
  });

  it.each([
    [[{ type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] }]],
    [JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] }])],
    [{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] }] }],
  ])('converts structured descriptions into separate plain-text paragraphs', async (description) => {
    state.row!.attributes = { description };
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(worksheetContext, [ticketId]);
    expect(result?.ticketDescription).toBe('First paragraph\nSecond paragraph');
    expect(result?.ticketDescriptionRichText).toBe(description);
  });

  it.each([null, '', '  ', '[]'])('returns null for an empty description (%s)', async (description) => {
    state.row!.attributes = { description };
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(worksheetContext, [ticketId]);
    expect(result?.ticketDescription).toBeNull();
    expect(result?.ticketDescriptionRichText).toBeNull();
  });

  it('retains image-only structured content without requiring a plain-text projection', async () => {
    const description = [{ type: 'image', props: { url: 'https://example.com/image.png', name: 'Screenshot' } }];
    state.row!.attributes = { description };
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(worksheetContext, [ticketId]);
    expect(result?.ticketDescription).toBeNull();
    expect(result?.ticketDescriptionRichText).toBe(description);
  });

  it('does not read worksheet data without coarse and record-level ticket authorization', async () => {
    state.permitted = false;
    expect(await ticketLabelViewModelProvider.getLabelViewModels(worksheetContext, [ticketId])).toEqual([null]);
    expect(state.queries).toBe(0);

    state.permitted = true;
    state.authorizationError = new Error('Permission denied: ticket is not readable');
    expect(await ticketLabelViewModelProvider.getLabelViewModels(worksheetContext, [ticketId])).toEqual([null]);
    expect(state.queries).toBe(0);
  });
});
