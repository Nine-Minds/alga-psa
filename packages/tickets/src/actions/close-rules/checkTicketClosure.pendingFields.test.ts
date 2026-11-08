// @vitest-environment node

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Save Changes that sets the classification and the closing status in one
 * batch is written as a single update, so the pre-close check has to evaluate
 * the gates against the values that batch carries. Checking the stored row
 * blocked the save with "Required fields are missing: Category, Subcategory"
 * even though the same request was about to fill them.
 */

const evaluateTicketCloseRulesMock = vi.fn();
const hasPermissionMock = vi.fn();

const ticketRow = {
  ticket_id: 'ticket-1',
  board_id: 'board-1',
  status_id: 'status-open',
  category_id: null,
  subcategory_id: null,
  priority_id: 'priority-1',
  assigned_to: 'user-9',
};

const statusRows: Record<string, { status_id: string; is_closed: boolean }> = {
  'status-open': { status_id: 'status-open', is_closed: false },
  'status-closed': { status_id: 'status-closed', is_closed: true },
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  tenantDb: () => ({
    table: (table: string) => {
      const builder = {
        where: (criteria: Record<string, unknown>) => {
          if (table === 'tickets') {
            return { first: async () => (criteria.ticket_id === ticketRow.ticket_id ? ticketRow : undefined) };
          }
          if (table === 'statuses') {
            return { first: async () => statusRows[criteria.status_id as string] };
          }
          return { first: async () => undefined };
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
      (...args: unknown[]) =>
        action({ user_id: 'user-1', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('../../lib/validateTicketClosure', async () => {
  const constants = await import('../../lib/closeRuleConstants');
  return {
    ...constants,
    evaluateTicketCloseRules: (...args: unknown[]) => evaluateTicketCloseRulesMock(...args),
  };
});

const { checkTicketClosure } = await import('./closeRuleActions');

describe('checkTicketClosure pending required fields', () => {
  beforeEach(() => {
    evaluateTicketCloseRulesMock.mockReset();
    evaluateTicketCloseRulesMock.mockResolvedValue([]);
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(false);
  });

  it('evaluates the gates against the classification the batch is about to save', async () => {
    const result = await checkTicketClosure('ticket-1', 'status-closed', {
      status_id: 'status-closed',
      category_id: 'cat-hardware',
      subcategory_id: 'cat-desktop',
    });

    expect(result).toEqual({ wouldClose: true, allowed: true, failures: [], canOverride: false });
    expect(evaluateTicketCloseRulesMock).toHaveBeenCalledWith({}, 'tenant-1', {
      ticket_id: 'ticket-1',
      board_id: 'board-1',
      category_id: 'cat-hardware',
      subcategory_id: 'cat-desktop',
      priority_id: 'priority-1',
      assigned_to: 'user-9',
    });
  });

  it('falls back to the stored values for fields the batch does not touch', async () => {
    await checkTicketClosure('ticket-1', 'status-closed');

    expect(evaluateTicketCloseRulesMock).toHaveBeenCalledWith({}, 'tenant-1', {
      ticket_id: 'ticket-1',
      board_id: 'board-1',
      category_id: null,
      subcategory_id: null,
      priority_id: 'priority-1',
      assigned_to: 'user-9',
    });
  });

  it('treats a cleared field in the batch as missing', async () => {
    evaluateTicketCloseRulesMock.mockResolvedValue([
      { rule: 'required_fields', message: 'Required fields are missing: Assignee' },
    ]);

    const result = await checkTicketClosure('ticket-1', 'status-closed', {
      status_id: 'status-closed',
      assigned_to: 'unassigned',
    });

    expect(evaluateTicketCloseRulesMock).toHaveBeenCalledWith({}, 'tenant-1', {
      ticket_id: 'ticket-1',
      board_id: 'board-1',
      category_id: null,
      subcategory_id: null,
      priority_id: 'priority-1',
      assigned_to: null,
    });
    expect(result.allowed).toBe(false);
  });

  it('ignores batch keys that are not close-rule required fields', async () => {
    await checkTicketClosure('ticket-1', 'status-closed', {
      status_id: 'status-closed',
      title: 'renamed',
      board_id: 'board-evil',
    });

    expect(evaluateTicketCloseRulesMock).toHaveBeenCalledWith({}, 'tenant-1', {
      ticket_id: 'ticket-1',
      board_id: 'board-1',
      category_id: null,
      subcategory_id: null,
      priority_id: 'priority-1',
      assigned_to: 'user-9',
    });
  });

  it('skips evaluation when the target status does not close the ticket', async () => {
    const result = await checkTicketClosure('ticket-1', 'status-open', { category_id: 'cat-hardware' });

    expect(result).toEqual({ wouldClose: false, allowed: true, failures: [], canOverride: false });
    expect(evaluateTicketCloseRulesMock).not.toHaveBeenCalled();
  });
});

describe('pickCloseRulePendingFields', () => {
  it('keeps only the required fields and normalizes the empty sentinels', async () => {
    const { pickCloseRulePendingFields } = await import('../../lib/closeRuleConstants');

    expect(
      pickCloseRulePendingFields({
        category_id: 'cat-hardware',
        subcategory_id: '',
        priority_id: null,
        assigned_to: 'unassigned',
        title: 'renamed',
      })
    ).toEqual({
      category_id: 'cat-hardware',
      subcategory_id: null,
      priority_id: null,
      assigned_to: null,
    });
  });

  it('omits untouched fields so the stored value stands', async () => {
    const { pickCloseRulePendingFields } = await import('../../lib/closeRuleConstants');

    expect(pickCloseRulePendingFields({ status_id: 'status-closed' })).toEqual({});
    expect(pickCloseRulePendingFields(null)).toEqual({});
  });
});

describe('batch save wiring', () => {
  const detailsSource = readFileSync(
    resolve(__dirname, '../../components/ticket/TicketDetails.tsx'),
    'utf8',
  );

  it('forwards the batch pending fields to the pre-close check', () => {
    const batchSection = detailsSource.slice(
      detailsSource.indexOf('const handleBatchSaveChanges'),
      detailsSource.indexOf('const closeTicketForResolution'),
    );
    expect(batchSection).toContain('pickCloseRulePendingFields(changes)');
  });
});
