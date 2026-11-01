import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));
const grantRef = vi.hoisted(() => ({ granted: new Set<string>() }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

// The principal and the granted permission set are controlled per test; the
// action code, guard, transactions and all DB state are real.
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async (_user: any, resource: string, action: string) =>
    grantRef.granted.has(`${resource}:${action}`)),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import {
  createBoard,
  updateBoard,
  deleteBoard,
} from '../../../../packages/tickets/src/actions/board-actions/boardActions';

import { deleteWizardBoard } from '../../../../packages/onboarding/src/lib/deleteWizardBoard';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

const tenantTable = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function seed() {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const defaultBoardId = uuidv4();
  const otherBoardId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });
  await tenantTable(tenantId, 'boards').insert([
    { board_id: defaultBoardId, board_name: 'General', display_order: 10, is_default: true },
    { board_id: otherBoardId, board_name: 'Other', display_order: 20, is_default: false },
  ].map((b) => ({ tenant: tenantId, is_inactive: false, category_type: 'custom', priority_type: 'custom', ...b })));

  dbRef.knex = db;
  dbRef.tenant = tenantId;
  userRef.user = { user_id: userId, user_type: 'internal', tenant: tenantId };
  return { tenantId, userId, defaultBoardId, otherBoardId };
}

async function boardState(tenantId: string) {
  return tenantTable(tenantId, 'boards').select('board_id', 'board_name', 'is_default').orderBy('board_name');
}

describe('board mutation authorization (real DB)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  beforeEach(() => grantRef.granted.clear());

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('createBoard without ticket_settings:create is denied and the default board is untouched', async () => {
    const { tenantId, defaultBoardId } = await seed();
    grantRef.granted.add('ticket_settings:update');
    grantRef.granted.add('ticket:create');
    const before = await boardState(tenantId);

    const result = await createBoard({ board_name: 'Evil', is_default: true } as any);

    expect(result).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });
    expect(await boardState(tenantId)).toEqual(before);
    const def = await tenantTable(tenantId, 'boards').where({ board_id: defaultBoardId }).first();
    expect(def.is_default).toBe(true);
  }, HOOK_TIMEOUT);

  it('createBoard by a client-portal principal is denied even with the permission', async () => {
    const { tenantId } = await seed();
    grantRef.granted.add('ticket_settings:create');
    userRef.user = { ...userRef.user, user_type: 'client' };
    const before = await boardState(tenantId);

    const result = await createBoard({ board_name: 'Evil' } as any);

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(await boardState(tenantId)).toEqual(before);
  }, HOOK_TIMEOUT);

  it('updateBoard without ticket_settings:update is denied, with no pinned/view/status keys in the payload', async () => {
    const { tenantId, defaultBoardId, otherBoardId } = await seed();
    const before = await boardState(tenantId);

    const result = await updateBoard(otherBoardId, { is_default: true, board_name: 'Hijacked' } as any);

    expect(result).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });
    expect(await boardState(tenantId)).toEqual(before);
    const def = await tenantTable(tenantId, 'boards').where({ board_id: defaultBoardId }).first();
    expect(def.is_default).toBe(true);
  }, HOOK_TIMEOUT);

  it('updateBoard rejects tenant/board_id/unknown keys with no DB change', async () => {
    const { tenantId, otherBoardId } = await seed();
    grantRef.granted.add('ticket_settings:update');
    const before = await boardState(tenantId);

    for (const extra of [{ tenant: uuidv4() }, { board_id: uuidv4() }, { not_a_column: 1 }]) {
      const result = await updateBoard(otherBoardId, { board_name: 'Renamed', ...extra } as any);
      expect(result).toMatchObject({ actionError: expect.stringContaining('Invalid board input') });
    }
    expect(await boardState(tenantId)).toEqual(before);
  }, HOOK_TIMEOUT);

  it('deleteBoard with ticket:delete but without ticket_settings:delete is denied and the row remains', async () => {
    const { tenantId, otherBoardId } = await seed();
    grantRef.granted.add('ticket:delete');

    const result = await deleteBoard(otherBoardId);

    expect(result).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
    const row = await tenantTable(tenantId, 'boards').where({ board_id: otherBoardId }).first();
    expect(row).toBeTruthy();
  }, HOOK_TIMEOUT);

  it('a permitted internal user can create, update (moving the default) and delete', async () => {
    const { tenantId, defaultBoardId, otherBoardId } = await seed();
    grantRef.granted.add('ticket_settings:create');
    grantRef.granted.add('ticket_settings:update');
    grantRef.granted.add('ticket_settings:delete');

    const created = await createBoard({
      board_name: 'Fresh',
      ticket_statuses: [{ name: 'Open', is_closed: false, is_default: true }],
    } as any);
    expect(created).toMatchObject({ board_name: 'Fresh' });
    const freshId = (created as any).board_id as string;
    expect(await tenantTable(tenantId, 'boards').where({ board_id: freshId }).first()).toBeTruthy();

    const updated = await updateBoard(otherBoardId, { board_name: 'Other renamed', is_default: true } as any);
    expect(updated).toMatchObject({ board_name: 'Other renamed', is_default: true });
    const oldDefault = await tenantTable(tenantId, 'boards').where({ board_id: defaultBoardId }).first();
    expect(oldDefault.is_default).toBe(false);

    const deleted = await deleteBoard(defaultBoardId);
    expect(deleted.success).toBe(true);
    expect(await tenantTable(tenantId, 'boards').where({ board_id: defaultBoardId }).first()).toBeUndefined();
  }, HOOK_TIMEOUT);

  describe('Setup wizard board delete (deleteWizardBoard -> deleteBoard)', () => {
    async function createBoardWithStatuses() {
      const seeded = await seed();
      grantRef.granted.add('ticket_settings:create');
      const created = await createBoard({
        board_name: 'Wizard board',
        ticket_statuses: [
          { name: 'Open', is_closed: false, is_default: true },
          { name: 'Closed', is_closed: true },
        ],
      } as any);
      const boardId = (created as any).board_id as string;
      const statusCount = async () =>
        Number((await tenantTable(seeded.tenantId, 'statuses').where({ board_id: boardId }).count('* as c').first())?.c);
      expect(await statusCount()).toBe(2);
      return { ...seeded, boardId, statusCount };
    }

    it('deletes a board that has statuses (no statuses_tenant_board_id_fk failure) for a permitted user', async () => {
      const { tenantId, boardId, statusCount } = await createBoardWithStatuses();
      grantRef.granted.add('ticket_settings:delete');

      const result = await deleteWizardBoard(boardId, deleteBoard);

      expect(result).toMatchObject({ success: true });
      expect(await tenantTable(tenantId, 'boards').where({ board_id: boardId }).first()).toBeUndefined();
      expect(await statusCount()).toBe(0);
    }, HOOK_TIMEOUT);

    it('refuses a user without ticket_settings:delete and leaves board and statuses intact', async () => {
      const { tenantId, boardId, statusCount } = await createBoardWithStatuses();
      grantRef.granted.add('ticket:delete');

      const result = await deleteWizardBoard(boardId, deleteBoard);

      expect(result).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
      expect(await tenantTable(tenantId, 'boards').where({ board_id: boardId }).first()).toBeTruthy();
      expect(await statusCount()).toBe(2);
    }, HOOK_TIMEOUT);
  });
});
