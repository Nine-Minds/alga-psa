import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Watcher writes must pass the same per-record ticket:update decision as editing
 * the ticket (alga-2026-0002925). A user who may READ a ticket but whose bundle
 * keeps it out of UPDATE scope must not be able to add/toggle/remove watchers.
 */

const IN_SCOPE = '11111111-1111-4111-8111-111111111111';
const OUT_OF_SCOPE = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';

let currentUser: any;
let bundleRules: Array<Record<string, unknown>> = [];
const tickets: Record<string, any> = {};
const watcherServiceCalls: string[] = [];

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: any, cb: any) => cb({}),
  // tenant-scoped fake: rows are only visible to their own tenant
  tenantDb: (_conn: any, tenant: string) => ({
    table: (table: string) => {
      let id: string | undefined;
      const qb: any = {
        where: (w: any) => { id = w.ticket_id; return qb; },
        forUpdate: () => qb,
        select: async () => [],
        first: async () => {
          if (table !== 'tickets') return undefined;
          const row = id ? tickets[id] : undefined;
          return row && row.tenant === tenant ? row : undefined;
        },
      };
      return qb;
    },
  }),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => bundleRules),
}));
vi.mock('./clientPortalVisibility.server', () => ({ getClientContactVisibilityContext: vi.fn() }));
vi.mock('../lib/clientPortalVisibility.server', () => ({ getClientContactVisibilityContext: vi.fn() }));
vi.mock('@alga-psa/shared/services/tickets/ticketWatcherService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/services/tickets/ticketWatcherService')>();
  const result = { watchers: [], changed: true };
  return {
    ...actual,
    TicketWatcherService: {
      add: vi.fn(async () => { watcherServiceCalls.push('add'); return result; }),
      setActive: vi.fn(async () => { watcherServiceCalls.push('setActive'); return result; }),
      remove: vi.fn(async () => { watcherServiceCalls.push('remove'); return result; }),
    },
  };
});

import { addTicketWatchers, removeTicketWatcher, setTicketWatcherActive } from './ticketWatcherActions';

const DENIED = 'Permission denied: Cannot update ticket watchers';

describe('ticket watcher writes: record-level ticket:update authorization', () => {
  beforeEach(() => {
    watcherServiceCalls.length = 0;
    currentUser = { user_id: 'u1', user_type: 'internal', tenant: 'tenant-1', roles: [] };
    tickets[IN_SCOPE] = { tenant: 'tenant-1', ticket_id: IN_SCOPE, client_id: 'client-ok', board_id: 'b1', attributes: {} };
    tickets[OUT_OF_SCOPE] = { tenant: 'tenant-1', ticket_id: OUT_OF_SCOPE, client_id: 'client-blocked', board_id: 'b1', attributes: {} };
    tickets[OTHER_TENANT] = { tenant: 'tenant-2', ticket_id: OTHER_TENANT, client_id: 'client-ok', board_id: 'b1', attributes: {} };
    // Read is unrestricted; update is limited to client-ok.
    bundleRules = [
      { id: 'update-narrow', resource: 'ticket', action: 'update', templateKey: 'selected_clients', selectedClientIds: ['client-ok'] },
    ];
  });

  it('denies add / setActive / remove on a ticket outside update scope, with no watcher writes', async () => {
    await expect(addTicketWatchers(OUT_OF_SCOPE, [{ email: 'evil@example.com' }])).rejects.toThrow(DENIED);
    await expect(setTicketWatcherActive(OUT_OF_SCOPE, 'evil@example.com', false)).rejects.toThrow(DENIED);
    await expect(removeTicketWatcher(OUT_OF_SCOPE, 'evil@example.com')).rejects.toThrow(DENIED);
    expect(watcherServiceCalls).toEqual([]);
  });

  it('still allows add / setActive / remove on an in-scope ticket', async () => {
    expect(await addTicketWatchers(IN_SCOPE, [{ email: 'a@example.com' }])).toEqual({ watchers: [] });
    expect(await setTicketWatcherActive(IN_SCOPE, 'a@example.com', false)).toEqual({ watchers: [] });
    expect(await removeTicketWatcher(IN_SCOPE, 'a@example.com')).toEqual({ watchers: [] });
    expect(watcherServiceCalls).toEqual(['add', 'setActive', 'remove']);
  });

  it.each([
    ['nonexistent', '44444444-4444-4444-8444-444444444444'],
    ['cross-tenant', OTHER_TENANT],
    ['malformed', 'not-a-uuid'],
  ])('fails closed (not found, no writes) for a %s ticket id', async (_label, id) => {
    const expected = { actionError: 'Ticket not found' };
    expect(await addTicketWatchers(id, [{ email: 'a@example.com' }])).toMatchObject(expected);
    expect(await setTicketWatcherActive(id, 'a@example.com', true)).toMatchObject(expected);
    expect(await removeTicketWatcher(id, 'a@example.com')).toMatchObject(expected);
    expect(watcherServiceCalls).toEqual([]);
  });

  it('REST TicketService routes watcher writes through the same shared command and maps denial to 403', () => {
    const src = readFileSync(path.resolve(__dirname, '../../../../server/src/lib/api/services/TicketService.ts'), 'utf8');
    expect(src).toContain('runAuthorizedTicketWatcherWrite');
    expect(src).toContain('buildAuthorizationPrincipalSubject(');
    expect(src).toMatch(/TicketWatcherPermissionError\)\s*{\s*return new ForbiddenError/);
  });
});
