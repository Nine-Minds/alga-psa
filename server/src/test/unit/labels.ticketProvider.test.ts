import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelRequestContext } from '@alga-psa/types';

const state = vi.hoisted(() => ({
  permitted: true,
  authorizationError: null as Error | null,
  row: null as Record<string, unknown> | null,
  selected: [] as string[],
  queries: 0,
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => state.permitted }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: () => {
      state.queries += 1;
      const query = {
        where: () => query,
        select: (...columns: string[]) => {
          state.selected.push(...columns);
          return query;
        },
        first: async () => state.row,
      };
      return query;
    },
    tenantJoin: () => undefined,
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
  state.queries = 0;
  state.row = {
    ticket_id: ticketId,
    ticket_number: 'TIC-1',
    title: 'Broken laptop',
    client_name: 'Client',
    category_name: 'Hardware',
    subcategory_name: 'Laptop',
    attributes: { description: 'First paragraph\nSecond paragraph' },
  };
});

describe('ticketLabelViewModelProvider worksheet details', () => {
  it('does not read or return a description for ordinary tags', async () => {
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(context, [ticketId]);
    expect(state.selected).not.toContain('t.attributes');
    expect(result).not.toHaveProperty('ticketDescription');
    expect(result?.detail).toBe('Laptop');
  });

  it('preserves legacy plain text and does not apply the 160-character summary limit', async () => {
    const description = `${'A'.repeat(200)}\nSecond paragraph`;
    state.row!.attributes = { description };
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(worksheetContext, [ticketId]);
    expect(state.selected).toContain('t.attributes');
    expect(result?.ticketDescription).toBe(description);
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
  });

  it.each([null, '', '  ', '[]'])('returns null for an empty description (%s)', async (description) => {
    state.row!.attributes = { description };
    const [result] = await ticketLabelViewModelProvider.getLabelViewModels(worksheetContext, [ticketId]);
    expect(result?.ticketDescription).toBeNull();
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
