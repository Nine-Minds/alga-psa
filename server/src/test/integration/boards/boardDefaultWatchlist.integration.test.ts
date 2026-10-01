import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from 'server/test-utils/testContext';
import { createTenant, createUser } from 'server/test-utils/testDataFactory';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { createTicketForAlert } from '@alga-psa/shared/rmm/alerts';
import { upsertTicketWatchListRecipients } from '@alga-psa/shared/workflow/actions/emailWorkflowActions';
import { parseTicketWatchListAttributes, getActiveWatchListEmails } from '@alga-psa/shared/lib/tickets/watchList';
import { createBoard, updateBoard, findBoardById } from '@alga-psa/tickets/actions/board-actions/boardActions';
import { isActionMessageError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';

const dbRef = vi.hoisted(() => ({ knex: null as any, tenant: '' as string }));
const userRef = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  // upsertTicketWatchListRecipients opens an admin transaction; reuse the test connection it is handed.
  withAdminTransaction: vi.fn(async (cb: any, existing?: any) => cb(existing ?? dbRef.knex)),
}));

vi.mock('@alga-psa/auth', () => {
  const wrap = (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args);
  return {
    withAuth: wrap,
    withOptionalAuth: wrap,
    withAuthCheck: wrap,
    hasPermission: vi.fn(async () => true),
    getCurrentUser: vi.fn(async () => userRef.user),
    getSession: vi.fn(async () => ({ user: { id: userRef.user?.user_id, tenant: dbRef.tenant } })),
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

const HOOK_TIMEOUT = 240_000;
const helpers = TestContext.createHelpers();

describe('Board default watchlist (alga-2026-0002379 Feature C)', () => {
  let ctx: TestContext;
  let boardId: string;
  let otherBoardId: string;
  let priorityId: string;
  let agentA: string;
  let agentB: string;

  const table = (name: string) => tenantDb(ctx.db, ctx.tenantId).table(name);

  async function insertBoard(name: string): Promise<string> {
    const id = uuidv4();
    await table('boards').insert({
      tenant: ctx.tenantId,
      board_id: id,
      board_name: name,
      is_default: false,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
      display_order: 10,
    });
    await table('statuses').insert({
      tenant: ctx.tenantId,
      status_id: uuidv4(),
      board_id: id,
      name: `${name} open`,
      status_type: 'ticket',
      item_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 1,
      created_by: ctx.userId,
    });
    return id;
  }

  const setWatchlist = (id: string, enabled: boolean, doc: { user_ids?: string[]; emails?: string[] } | null) =>
    table('boards')
      .where({ board_id: id })
      .update({
        default_watchlist_enabled: enabled,
        default_watchlist: doc ? JSON.stringify({ user_ids: [], emails: [], ...doc }) : null,
      });

  async function createViaModel(board: string, extra: Record<string, unknown> = {}) {
    return ctx.db.transaction((trx) =>
      TicketModel.createTicketWithRetry(
        {
          title: 'Printer offline',
          client_id: ctx.clientId,
          board_id: board,
          priority_id: priorityId,
          ...extra,
        } as any,
        ctx.tenantId,
        trx,
        {},
        undefined,
        undefined,
        ctx.userId,
        1
      )
    );
  }

  const ticketRow = (ticketId: string) => table('tickets').where({ ticket_id: ticketId }).first();
  const watchListOf = async (ticketId: string) => parseTicketWatchListAttributes((await ticketRow(ticketId)).attributes);

  beforeAll(async () => {
    ctx = await helpers.beforeAll({});
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    dbRef.knex = ctx.db;
    dbRef.tenant = ctx.tenantId;

    agentA = await createUser(ctx.db, ctx.tenantId, { first_name: 'Ada', last_name: 'Agent', email: 'ada@msp.example' });
    agentB = await createUser(ctx.db, ctx.tenantId, { first_name: 'Ben', last_name: 'Agent', email: 'ben@msp.example' });
    userRef.user = { user_id: ctx.userId, tenant: ctx.tenantId, user_type: 'internal', roles: [] };

    priorityId = uuidv4();
    await table('priorities').insert({
      tenant: ctx.tenantId,
      priority_id: priorityId,
      priority_name: 'High',
      item_type: 'ticket',
      order_number: 1,
      color: '#EF4444',
      created_by: ctx.userId,
    });
    boardId = await insertBoard('Support');
    otherBoardId = await insertBoard('Billing');
  }, HOOK_TIMEOUT);

  describe('storage', () => {
    it('defaults to off with no recipients on an existing board', async () => {
      const board = await table('boards').where({ board_id: boardId }).first();
      expect(board.default_watchlist_enabled).toBe(false);
      expect(board.default_watchlist).toBeNull();
    });

    it('updateBoard saves the switch and normalises recipients', async () => {
      const result = await updateBoard(boardId, {
        default_watchlist_enabled: true,
        default_watchlist: { user_ids: [agentA, agentA.toUpperCase()], emails: ['  Ops@Customer.EXAMPLE ', 'ops@customer.example', 'dl@msp.example'] },
      });
      expect(isActionMessageError(result)).toBe(false);

      const stored = await table('boards').where({ board_id: boardId }).first();
      expect(stored.default_watchlist_enabled).toBe(true);
      expect(stored.default_watchlist).toEqual({ user_ids: [agentA], emails: ['ops@customer.example', 'dl@msp.example'] });

      const read = await findBoardById(boardId);
      expect((read as any).default_watchlist_enabled).toBe(true);
      expect((read as any).default_watchlist.emails).toHaveLength(2);
    });

    it('disabling keeps the recipient list', async () => {
      await updateBoard(boardId, { default_watchlist_enabled: true, default_watchlist: { user_ids: [], emails: ['dl@msp.example'] } });
      await updateBoard(boardId, { default_watchlist_enabled: false });
      const stored = await table('boards').where({ board_id: boardId }).first();
      expect(stored.default_watchlist_enabled).toBe(false);
      expect(stored.default_watchlist.emails).toEqual(['dl@msp.example']);
    });

    it('rejects an invalid address with a readable error and stores nothing', async () => {
      const result = await updateBoard(boardId, {
        default_watchlist_enabled: true,
        default_watchlist: { user_ids: [], emails: ['dl@msp.example', 'not-an-email'] },
      });
      expect(isActionMessageError(result)).toBe(true);
      expect(getErrorMessage(result)).toContain('not-an-email');
      const stored = await table('boards').where({ board_id: boardId }).first();
      expect(stored.default_watchlist_enabled).toBe(false);
      expect(stored.default_watchlist).toBeNull();
    });

    it('rejects a malformed user id', async () => {
      const result = await updateBoard(boardId, { default_watchlist: { user_ids: ['nope'], emails: [] } });
      expect(isActionMessageError(result)).toBe(true);
    });

    it('createBoard persists the watchlist', async () => {
      const created = await createBoard({
        board_name: 'Projects',
        is_inactive: false,
        default_watchlist_enabled: true,
        default_watchlist: { user_ids: [agentB], emails: ['pm@msp.example'] },
      } as any);
      expect(isActionMessageError(created)).toBe(false);
      const stored = await table('boards').where({ board_id: (created as any).board_id }).first();
      expect(stored.default_watchlist_enabled).toBe(true);
      expect(stored.default_watchlist).toEqual({ user_ids: [agentB], emails: ['pm@msp.example'] });
    });
  });

  describe('application at ticket creation', () => {
    it('TicketModel path: adds the watchers, leaves assignment alone', async () => {
      await setWatchlist(boardId, true, { user_ids: [agentA], emails: ['dl@msp.example'] });

      const { ticket_id } = await createViaModel(boardId);

      const watchers = await watchListOf(ticket_id);
      expect(watchers.map((w) => w.email).sort()).toEqual(['ada@msp.example', 'dl@msp.example']);
      expect(watchers.every((w) => w.active && w.source === 'board_default')).toBe(true);
      const ada = watchers.find((w) => w.email === 'ada@msp.example')!;
      expect(ada).toMatchObject({ entity_type: 'user', entity_id: agentA, name: 'Ada Agent' });

      const row = await ticketRow(ticket_id);
      expect(row.assigned_to).toBeNull();
      expect(row.assigned_team_id).toBeNull();
      expect(await table('ticket_resources').where({ ticket_id }).count('* as n').first()).toMatchObject({ n: '0' });
    });

    it('RMM alert path (direct insert): adds the watchers, keeps the explicit assignee', async () => {
      await setWatchlist(boardId, true, { user_ids: [agentB], emails: ['noc@msp.example'] });

      const created = await ctx.db.transaction((trx) =>
        createTicketForAlert(trx, {
          event: {
            tenantId: ctx.tenantId,
            integrationId: uuidv4(),
            provider: 'ninjaone',
            kind: 'triggered',
            externalAlertId: `ext-${uuidv4().slice(0, 8)}`,
            severity: 'major',
            message: 'Disk full',
            occurredAt: new Date().toISOString(),
            raw: {},
          } as any,
          actions: { createTicket: true, boardId, priorityOverride: priorityId, assignToUserId: agentA },
          clientId: ctx.clientId,
        })
      );

      const watchers = await watchListOf(created.ticket_id);
      expect(watchers.map((w) => w.email).sort()).toEqual(['ben@msp.example', 'noc@msp.example']);
      const row = await ticketRow(created.ticket_id);
      expect(row.assigned_to).toBe(agentA);
      // description/source_reference the creator already stored are preserved
      expect(row.attributes.description).toBeTruthy();
    });

    it('inbound email path: board defaults compose with the sender/To/Cc watchers upserted afterwards', async () => {
      await setWatchlist(boardId, true, { emails: ['dl@msp.example'] });

      const { ticket_id } = await createViaModel(boardId, {
        source: 'email',
        ticket_origin: 'inbound_email',
      });
      await upsertTicketWatchListRecipients(
        {
          ticketId: ticket_id,
          recipients: [
            { email: 'requester@customer.example', source: 'inbound_from' },
            { email: 'DL@msp.example', source: 'inbound_cc' },
          ],
        },
        ctx.tenantId,
        ctx.db
      );

      const watchers = await watchListOf(ticket_id);
      expect(watchers.map((w) => w.email).sort()).toEqual(['dl@msp.example', 'requester@customer.example']);
      expect(watchers.find((w) => w.email === 'dl@msp.example')!.source).toBe('board_default');
    });

    it('de-duplicates against watchers supplied at creation, and does not re-activate an inactive one', async () => {
      await setWatchlist(boardId, true, { user_ids: [agentA], emails: ['dl@msp.example'] });

      const { ticket_id } = await createViaModel(boardId, {
        attributes: {
          watch_list: [
            { email: 'ADA@msp.example', active: false, source: 'manual' },
            { email: 'cc@customer.example', active: true, source: 'inbound_cc' },
          ],
        },
      });

      const watchers = await watchListOf(ticket_id);
      expect(watchers.map((w) => w.email).sort()).toEqual(['ada@msp.example', 'cc@customer.example', 'dl@msp.example']);
      const ada = watchers.find((w) => w.email === 'ada@msp.example')!;
      expect(ada.active).toBe(false);
      expect(ada.source).toBe('manual');
      expect(getActiveWatchListEmails((await ticketRow(ticket_id)).attributes).sort()).toEqual([
        'cc@customer.example',
        'dl@msp.example',
      ]);
    });

    it('a user listed by id and the same address typed as an email produce one watcher', async () => {
      await setWatchlist(boardId, true, { user_ids: [agentA], emails: ['ada@msp.example'] });
      const { ticket_id } = await createViaModel(boardId);
      const watchers = await watchListOf(ticket_id);
      expect(watchers).toHaveLength(1);
      expect(watchers[0].entity_id).toBe(agentA);
    });

    it('does nothing when the watchlist is disabled, even with recipients stored', async () => {
      await setWatchlist(boardId, false, { user_ids: [agentA], emails: ['dl@msp.example'] });
      const { ticket_id } = await createViaModel(boardId);
      expect(await watchListOf(ticket_id)).toEqual([]);
      expect((await ticketRow(ticket_id)).attributes).toBeNull();
    });

    it('is scoped to the ticket\'s board', async () => {
      await setWatchlist(boardId, true, { emails: ['dl@msp.example'] });
      const { ticket_id } = await createViaModel(otherBoardId);
      expect(await watchListOf(ticket_id)).toEqual([]);
    });

    it('skips inactive users, client-portal users and users from another tenant', async () => {
      const inactive = await createUser(ctx.db, ctx.tenantId, { email: 'gone@msp.example', is_inactive: true } as any);
      const portal = await createUser(ctx.db, ctx.tenantId, { email: 'portal@customer.example', user_type: 'client' } as any);
      const otherTenant = await createTenant(ctx.db, 'Other MSP');
      const foreign = await createUser(ctx.db, otherTenant, { email: 'foreign@other.example' });
      await setWatchlist(boardId, true, { user_ids: [agentA, inactive, portal, foreign] });

      const { ticket_id } = await createViaModel(boardId);

      expect((await watchListOf(ticket_id)).map((w) => w.email)).toEqual(['ada@msp.example']);
    });

    it('a malformed stored document never blocks ticket creation', async () => {
      await table('boards')
        .where({ board_id: boardId })
        .update({ default_watchlist_enabled: true, default_watchlist: JSON.stringify({ user_ids: 'x', emails: [1, 'bad', 'ok@msp.example'] }) });
      const { ticket_id } = await createViaModel(boardId);
      expect((await watchListOf(ticket_id)).map((w) => w.email)).toEqual(['ok@msp.example']);
    });
  });
});
