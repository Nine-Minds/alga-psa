import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

/** user_id → granted `resource:action` keys. Every list read permission is granted unless removed. */
const grantsRef = vi.hoisted(() => ({
  grants: new Map<string, Set<string>>(),
}));

const hasPermissionMock = vi.hoisted(() =>
  vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    grantsRef.grants.get(user.user_id)?.has(`${resource}:${action}`) ?? false,
  ),
);

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

import {
  createListView,
  deleteListView,
  getListView,
  listListViews,
  setMyDefaultListView,
  updateListView,
} from '@alga-psa/list-views/actions';
import { ListViewModel } from '@alga-psa/list-views/models/listViewModel';
import { tenantDb } from '@alga-psa/db';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const HOOK_TIMEOUT = 240_000;
const READ_GRANTS = ['ticket:read', 'project:read', 'client:read', 'contact:read', 'asset:read'];

let db: Knex;
let userA: { user_id: string; user_type: 'internal' };
let userB: { user_id: string; user_type: 'internal' };

function actAs(user: { user_id: string }, extraGrants: string[] = []) {
  userRef.user = { ...user, user_type: 'internal' };
  grantsRef.grants.set(user.user_id, new Set([...READ_GRANTS, ...extraGrants]));
}

function expectOk<T>(result: T): Exclude<T, { actionError: string } | { permissionError: string }> {
  if (isActionMessageError(result) || isActionPermissionError(result)) {
    throw new Error(`Expected success, got: ${getErrorMessage(result)}`);
  }
  return result as Exclude<T, { actionError: string } | { permissionError: string }>;
}

const sampleSettings = {
  filters: { statusId: 'open', assignedToIds: ['00000000-0000-0000-0000-000000000001'] },
  sort: { by: 'due_date', direction: 'asc' as const },
  columns: { visibility: { client: false }, sizing: { title: 320 } },
  density: 30,
  pageSize: 25,
};

describe('named list views', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    dbRef.knex = db;

    const internalUsers = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of seeded internal users for list views integration')
      .where({ user_type: 'internal' })
      .orderBy('created_at', 'asc')
      .select('tenant', 'user_id');
    expect(internalUsers.length).toBeGreaterThan(0);
    const tenant = internalUsers[0].tenant;
    dbRef.tenant = tenant;
    const sameTenant = internalUsers.filter((row: { tenant: string }) => row.tenant === tenant);

    userA = { user_id: sameTenant[0].user_id, user_type: 'internal' };
    if (sameTenant.length > 1) {
      userB = { user_id: sameTenant[1].user_id, user_type: 'internal' };
    } else {
      // Seeds carry one internal user per tenant in some configurations; clone
      // it so the cross-user rules have a second principal.
      const source = await tenantDb(db, tenant).table('users').where({ user_id: userA.user_id }).first();
      const clonedId = uuidv4();
      await tenantDb(db, tenant).table('users').insert({
        ...source,
        user_id: clonedId,
        username: `list-views-${clonedId}`,
        email: `list-views-${clonedId}@example.com`,
      });
      userB = { user_id: clonedId, user_type: 'internal' };
    }
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await tenantDb(db, dbRef.tenant).table('list_views').whereIn('owner_user_id', [userA.user_id, userB.user_id]).del();
    await tenantDb(db, dbRef.tenant)
      .table('user_preferences')
      .whereIn('user_id', [userA.user_id, userB.user_id])
      .where('setting_name', 'like', 'listViews.default.%')
      .del();
  });

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('T001: never returns another user\'s private view, and hides it exactly like a missing one', async () => {
    actAs(userA, ['list_view:share']);
    const privateView = expectOk(await createListView('tickets', { name: 'My overdue P1s', visibility: 'private', settings: sampleSettings }));
    const sharedView = expectOk(await createListView('tickets', { name: 'Triage queue', visibility: 'shared', settings: sampleSettings }));

    actAs(userB);
    const collection = expectOk(await listListViews('tickets'));
    const ids = collection.views.map((view) => view.view_id);
    expect(ids).toContain(sharedView.view_id);
    expect(ids).not.toContain(privateView.view_id);
    const shared = collection.views.find((view) => view.view_id === sharedView.view_id)!;
    expect(shared.isOwner).toBe(false);
    expect(shared.canEdit).toBe(false);

    const privateLookup = await getListView(privateView.view_id);
    const missingLookup = await getListView(uuidv4());
    expect(isActionMessageError(privateLookup)).toBe(true);
    expect(privateLookup).toEqual(missingLookup);

    // Nor can it be changed, deleted or made a default through its id.
    expect(await updateListView(privateView.view_id, { name: 'Hijacked' })).toEqual(missingLookup);
    expect(await deleteListView(privateView.view_id)).toEqual(missingLookup);
    expect(await setMyDefaultListView('tickets', privateView.view_id)).toEqual(missingLookup);

    actAs(userA);
    const ownCollection = expectOk(await listListViews('tickets'));
    expect(ownCollection.views.map((view) => view.view_id).sort()).toEqual([privateView.view_id, sharedView.view_id].sort());
    expect(expectOk(await getListView(privateView.view_id)).settings).toEqual(sampleSettings);
  });

  it('T002: sharing requires list_view:share, on create and on update', async () => {
    actAs(userA);
    const denied = await createListView('tickets', { name: 'Team queue', visibility: 'shared', settings: {} });
    expect(isActionPermissionError(denied)).toBe(true);

    const privateView = expectOk(await createListView('tickets', { name: 'Team queue', visibility: 'private', settings: {} }));
    expect(isActionPermissionError(await updateListView(privateView.view_id, { visibility: 'shared' }))).toBe(true);

    actAs(userA, ['list_view:share']);
    const shared = expectOk(await updateListView(privateView.view_id, { visibility: 'shared' }));
    expect(shared.visibility).toBe('shared');
    const created = expectOk(await createListView('tickets', { name: 'Other queue', visibility: 'shared', settings: {} }));
    expect(created.visibility).toBe('shared');
  });

  it('T003: names are unique per owner and list, case-insensitively', async () => {
    actAs(userA);
    expectOk(await createListView('tickets', { name: 'Overdue', visibility: 'private', settings: {} }));
    const duplicate = await createListView('tickets', { name: '  OVERDUE ', visibility: 'private', settings: {} });
    expect(isActionMessageError(duplicate)).toBe(true);

    // Another list, or another owner, may reuse the name.
    expectOk(await createListView('projects', { name: 'Overdue', visibility: 'private', settings: {} }));
    actAs(userB);
    expectOk(await createListView('tickets', { name: 'Overdue', visibility: 'private', settings: {} }));

    // Empty and over-long names are rejected.
    expect(isActionMessageError(await createListView('tickets', { name: '   ', visibility: 'private', settings: {} }))).toBe(true);
    expect(isActionMessageError(await createListView('tickets', { name: 'x'.repeat(101), visibility: 'private', settings: {} }))).toBe(true);
  });

  it('T004: someone else\'s shared view is editable only with list_view:manage', async () => {
    actAs(userA, ['list_view:share']);
    const shared = expectOk(await createListView('tickets', { name: 'Dispatch', visibility: 'shared', settings: {} }));

    actAs(userB);
    expect(isActionPermissionError(await updateListView(shared.view_id, { name: 'Renamed' }))).toBe(true);
    expect(isActionPermissionError(await deleteListView(shared.view_id))).toBe(true);

    actAs(userB, ['list_view:manage']);
    const listed = expectOk(await listListViews('tickets')).views.find((view) => view.view_id === shared.view_id)!;
    expect(listed.canEdit).toBe(true);
    const renamed = expectOk(await updateListView(shared.view_id, { name: 'Renamed', settings: { pageSize: 50 } }));
    expect(renamed.name).toBe('Renamed');
    expect(renamed.settings).toEqual({ pageSize: 50 });
    // The owner is unchanged by an admin edit.
    expect(renamed.owner_user_id).toBe(userA.user_id);
    expect(expectOk(await deleteListView(shared.view_id))).toEqual({ deleted: true });
  });

  it('T005: deleting a view clears every user\'s default that pointed at it; defaults are per session user', async () => {
    actAs(userA, ['list_view:share']);
    const shared = expectOk(await createListView('tickets', { name: 'Shared default', visibility: 'shared', settings: {} }));
    expectOk(await setMyDefaultListView('tickets', shared.view_id));

    actAs(userB);
    expectOk(await setMyDefaultListView('tickets', shared.view_id));
    const bCollection = expectOk(await listListViews('tickets'));
    expect(bCollection.defaultViewId).toBe(shared.view_id);
    expect(bCollection.views.find((view) => view.view_id === shared.view_id)?.isMyDefault).toBe(true);

    // A's own default is untouched by B's choice.
    expect(await ListViewModel.getDefaultViewId(db, dbRef.tenant, userA.user_id, 'tickets')).toBe(shared.view_id);

    actAs(userA, ['list_view:share']);
    expectOk(await deleteListView(shared.view_id));
    expect(await ListViewModel.getDefaultViewId(db, dbRef.tenant, userA.user_id, 'tickets')).toBeNull();
    expect(await ListViewModel.getDefaultViewId(db, dbRef.tenant, userB.user_id, 'tickets')).toBeNull();

    // Clearing a default works and is idempotent.
    expect(expectOk(await setMyDefaultListView('tickets', null))).toEqual({ defaultViewId: null });
  });

  it('T006: settings failing the list schema, and unknown lists, are rejected', async () => {
    actAs(userA);
    const unknownKey = await createListView('tickets', {
      name: 'Bad',
      visibility: 'private',
      settings: { filters: { notAFilter: true } } as never,
    });
    expect(isActionMessageError(unknownKey)).toBe(true);

    const badDirection = await createListView('tickets', {
      name: 'Bad',
      visibility: 'private',
      settings: { sort: { by: 'title', direction: 'sideways' } } as never,
    });
    expect(isActionMessageError(badDirection)).toBe(true);

    const searchNotStored = await createListView('tickets', {
      name: 'Bad',
      visibility: 'private',
      settings: { filters: { searchQuery: 'printer' } } as never,
    });
    expect(isActionMessageError(searchNotStored)).toBe(true);

    // Updates run the same schema gate and leave the stored settings untouched.
    const existing = expectOk(await createListView('tickets', { name: 'Good', visibility: 'private', settings: { pageSize: 25 } }));
    const badUpdate = await updateListView(existing.view_id, {
      settings: { sort: { by: 'title', direction: 'sideways' } } as never,
    });
    expect(isActionMessageError(badUpdate)).toBe(true);
    expect(expectOk(await getListView(existing.view_id)).settings).toEqual({ pageSize: 25 });

    expect(isActionMessageError(await createListView('invoices', { name: 'Bad', visibility: 'private', settings: {} }))).toBe(true);
    expect(isActionMessageError(await listListViews('invoices'))).toBe(true);

    // The list's own read permission gates its views.
    grantsRef.grants.set(userA.user_id, new Set(READ_GRANTS.filter((grant) => grant !== 'asset:read')));
    expect(isActionPermissionError(await listListViews('assets'))).toBe(true);
  });

  it('T007: removing a user deletes their private views and hands shared views to the acting admin', async () => {
    actAs(userB, ['list_view:share']);
    const bPrivate = expectOk(await createListView('tickets', { name: 'B private', visibility: 'private', settings: {} }));
    const bShared = expectOk(await createListView('tickets', { name: 'Queue', visibility: 'shared', settings: {} }));

    // The admin already owns a view with the same name on the same list.
    actAs(userA);
    expectOk(await createListView('tickets', { name: 'queue', visibility: 'private', settings: {} }));

    await db.transaction((trx) => ListViewModel.handOverForDeletedUser(trx, dbRef.tenant, userB.user_id, userA.user_id));

    const remaining = await tenantDb(db, dbRef.tenant)
      .table('list_views')
      .whereIn('view_id', [bPrivate.view_id, bShared.view_id])
      .select('view_id', 'owner_user_id', 'name');
    expect(remaining).toEqual([{ view_id: bShared.view_id, owner_user_id: userA.user_id, name: 'Queue (2)' }]);
  });
});
