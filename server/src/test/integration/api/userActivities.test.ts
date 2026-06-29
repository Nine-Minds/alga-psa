/**
 * Real-DB integration tests for the v1 User Activities API (ad-hoc CRUD + unified list)
 * and its session→API-key identity bridge.
 *
 * Coverage:
 *  - Ad-hoc package cores (`createAdHocActivityForApi`, `updateAdHocActivityForApi`,
 *    `setAdHocActivityDoneForApi`, `deleteAdHocActivityForApi`, `getAdHocActivityForApi`)
 *    exercised directly against the test DB, asserting persisted rows.
 *  - `fetchUserActivitiesForApi` list shape, pagination, and the open/closed filter.
 *  - The route-level API-key bridge: a real `x-api-key` (no session) resolves the key's
 *    owner and creates a self-assigned ad-hoc item (POST /api/v1/activities/ad-hoc → 201);
 *    a request with neither session nor key is rejected (401).
 *
 * Harness notes:
 *  - TestContext runs each test in a rolled-back transaction and mocks the *server*
 *    `@/lib/db` helpers to that transaction. The package cores import `createTenantKnex`
 *    from `@alga-psa/db` (a different module), and the API-key bridge resolves its DB via
 *    `getConnection`, so both are mocked here to the same test transaction (`dbRef.db`).
 *    This keeps the uncommitted base entities (tenant/user) visible to the cores and the
 *    bridge, and lets the rollback clean everything up.
 *  - `next/cache` is mocked because the cores call `revalidatePath` outside a Next request.
 *  - The rate-limit enforcer is mocked to a no-op so the bridge path never touches Redis.
 *  - `@alga-psa/auth` is globally mocked by `src/test/setup.ts` (hasPermission → true).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { TestContext } from '../../../../test-utils/testContext';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';
import { setupTestUserWithPermissions } from '../../e2e/utils/simpleRoleSetup';

if (typeof (globalThis as any).AsyncLocalStorage === 'undefined') {
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
}

// Lazily-resolved handle to the active test transaction, read by the @alga-psa/db mock
// below. Populated in beforeEach once TestContext hands us the per-test transaction.
const dbRef = vi.hoisted(() => ({ db: null as any, tenant: '' }));

// The cores call revalidatePath('/msp/user-activities') from next/cache, which throws
// outside a Next request scope.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Route the package cores' createTenantKnex AND the API-key bridge's getConnection at the
// per-test transaction so they share the uncommitted base entities and roll back cleanly.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: dbRef.db, tenant: dbRef.tenant })),
    getConnection: vi.fn(async () => dbRef.db),
  };
});

// Keep the API-key bridge off Redis: the rate limiter is irrelevant to identity resolution.
vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: () => true,
}));

import {
  createAdHocActivityForApi,
  updateAdHocActivityForApi,
  setAdHocActivityDoneForApi,
  deleteAdHocActivityForApi,
  getAdHocActivityForApi,
  fetchUserActivitiesForApi,
  fetchUserActivitiesGroupedForApi,
  getUserActivityGroupsForApi,
  moveActivityToGroupForApi,
  removeActivityFromGroupsForApi,
  reorderActivitiesInGroupForApi,
} from '@alga-psa/user-activities/server/activity-actions';
import { hasPermission } from '@alga-psa/auth';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ActivityType } from '@alga-psa/types';
import { getScheduleActivityEntriesForUser } from '@alga-psa/scheduling/actions/scheduleActivityCore';

import { POST as createAdHocHandler } from '../../../app/api/v1/activities/ad-hoc/route';
import { GET as listActivitiesHandler } from '../../../app/api/v1/activities/route';
import {
  POST as moveGroupItemHandler,
  DELETE as removeGroupItemHandler,
} from '../../../app/api/v1/activities/groups/items/route';
import { PATCH as reorderGroupItemsHandler } from '../../../app/api/v1/activities/groups/[groupId]/items/route';

const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222';

describe('User Activities v1 API — ad-hoc CRUD, list, and the API-key bridge', () => {
  const testHelpers = TestContext.createHelpers();
  const origin = 'http://127.0.0.1';

  let ctx: TestContext;
  let tenantId = '';
  let userId = '';

  beforeAll(async () => {
    ctx = await testHelpers.beforeAll({
      cleanupTables: ['schedule_entry_assignees', 'schedule_entries', 'api_keys'],
    });
    tenantId = ctx.tenantId;
    userId = ctx.userId;
    dbRef.db = ctx.db;
    dbRef.tenant = tenantId;
  }, 120_000);

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  beforeEach(async () => {
    ctx = await testHelpers.beforeEach();
    tenantId = ctx.tenantId;
    userId = ctx.userId;
    dbRef.db = ctx.db;
    dbRef.tenant = tenantId;
    await setupTestUserWithPermissions(ctx.db, userId, tenantId);
    // Default permission posture: granted. Individual denial tests override per-call.
    vi.mocked(hasPermission).mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.mocked(hasPermission).mockResolvedValue(true);
    await testHelpers.afterEach();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function jsonRequest(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): NextRequest {
    const h = new Headers(headers);
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      h.set('content-type', 'application/json');
      payload = JSON.stringify(body);
    }
    return new NextRequest(new Request(url, { method, headers: h, body: payload }));
  }

  async function readJson<T = any>(response: Response): Promise<T> {
    return (await response.clone().json()) as T;
  }

  async function findAdHocByTitle(title: string) {
    return ctx.db('schedule_entries')
      .where({ tenant: tenantId, work_item_type: 'ad_hoc', title })
      .first();
  }

  // A user who is NOT an assignee of the seeded ad-hoc item, used to exercise the
  // permission branch of assertCanModifyAdHoc.
  function nonAssigneeUser() {
    return { user_id: randomUUID(), tenant: tenantId, roles: [] } as any;
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  it('creates a self-assigned ad-hoc item with no times (status scheduled, both times null)', async () => {
    const title = 'Buy milk';
    const created = await createAdHocActivityForApi(ctx.user, tenantId, { title, notes: '  remember  ' });

    expect(created.title).toBe(title);
    expect(created.type).toBe(ActivityType.SCHEDULE);

    const row = await findAdHocByTitle(title);
    expect(row).toBeTruthy();
    expect(row.work_item_type).toBe('ad_hoc');
    expect(row.work_item_id).toBeNull();
    expect(row.scheduled_start).toBeNull();
    expect(row.scheduled_end).toBeNull();
    expect(row.status).toBe('scheduled');
    expect(row.notes).toBe('remember'); // trimmed

    const assignees = await ctx.db('schedule_entry_assignees')
      .where({ tenant: tenantId, entry_id: row.entry_id })
      .pluck('user_id');
    expect(assignees).toEqual([userId]);
  });

  it('rejects creation when scheduledEnd <= scheduledStart (both supplied)', async () => {
    await expect(
      createAdHocActivityForApi(ctx.user, tenantId, {
        title: 'Bad window',
        scheduledStart: '2030-01-01T10:00:00.000Z',
        scheduledEnd: '2030-01-01T09:00:00.000Z',
      }),
    ).rejects.toThrow(/End time must be after start time/i);
  });

  it('accepts creation with only a start time (end stays null)', async () => {
    const title = 'Only a start';
    await createAdHocActivityForApi(ctx.user, tenantId, {
      title,
      scheduledStart: '2030-01-01T10:00:00.000Z',
    });

    const row = await findAdHocByTitle(title);
    expect(row).toBeTruthy();
    expect(row.scheduled_start).not.toBeNull();
    expect(row.scheduled_end).toBeNull();
  });

  it('rejects creation with a blank title', async () => {
    await expect(
      createAdHocActivityForApi(ctx.user, tenantId, { title: '   ' }),
    ).rejects.toThrow(/Title is required/i);
  });

  // ── Update ─────────────────────────────────────────────────────────────────

  it('updates title, notes and times for an assignee (happy path)', async () => {
    const created = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Original' });

    await updateAdHocActivityForApi(ctx.user, tenantId, created.id, {
      title: 'Renamed',
      notes: 'updated note',
      scheduledStart: '2030-02-01T08:00:00.000Z',
      scheduledEnd: '2030-02-01T09:00:00.000Z',
    });

    const row = await ctx.db('schedule_entries')
      .where({ tenant: tenantId, entry_id: created.id })
      .first();
    expect(row.title).toBe('Renamed');
    expect(row.notes).toBe('updated note');
    expect(row.scheduled_start).not.toBeNull();
    expect(row.scheduled_end).not.toBeNull();
  });

  it('denies update for a non-assignee lacking permission', async () => {
    const created = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Mine' });

    // The caller is not an assignee, so assertCanModifyAdHoc consults hasPermission.
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(
      updateAdHocActivityForApi(nonAssigneeUser(), tenantId, created.id, { title: 'Hijacked' }),
    ).rejects.toThrow(/Permission denied/i);

    const row = await ctx.db('schedule_entries')
      .where({ tenant: tenantId, entry_id: created.id })
      .first();
    expect(row.title).toBe('Mine'); // unchanged
  });

  // ── Done toggle ──────────────────────────────────────────────────────────────

  it('toggles done/undone for an assignee (status closed ↔ scheduled)', async () => {
    const created = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Toggle me' });

    await setAdHocActivityDoneForApi(ctx.user, tenantId, created.id, true);
    let row = await ctx.db('schedule_entries').where({ tenant: tenantId, entry_id: created.id }).first();
    expect(row.status).toBe('closed');

    await setAdHocActivityDoneForApi(ctx.user, tenantId, created.id, false);
    row = await ctx.db('schedule_entries').where({ tenant: tenantId, entry_id: created.id }).first();
    expect(row.status).toBe('scheduled');
  });

  it('denies done-toggle for a non-assignee lacking permission', async () => {
    const created = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Locked' });

    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(
      setAdHocActivityDoneForApi(nonAssigneeUser(), tenantId, created.id, true),
    ).rejects.toThrow(/Permission denied/i);

    const row = await ctx.db('schedule_entries').where({ tenant: tenantId, entry_id: created.id }).first();
    expect(row.status).toBe('scheduled'); // unchanged
  });

  // ── Delete ───────────────────────────────────────────────────────────────────

  it('deletes an ad-hoc item and its assignees for an assignee (happy path)', async () => {
    const created = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Delete me' });

    await deleteAdHocActivityForApi(ctx.user, tenantId, created.id);

    const row = await ctx.db('schedule_entries').where({ tenant: tenantId, entry_id: created.id }).first();
    expect(row).toBeUndefined();
    const assignees = await ctx.db('schedule_entry_assignees')
      .where({ tenant: tenantId, entry_id: created.id })
      .pluck('user_id');
    expect(assignees).toEqual([]);
  });

  it('denies delete for a non-assignee lacking permission', async () => {
    const created = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Keep me' });

    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(
      deleteAdHocActivityForApi(nonAssigneeUser(), tenantId, created.id),
    ).rejects.toThrow(/Permission denied/i);

    const row = await ctx.db('schedule_entries').where({ tenant: tenantId, entry_id: created.id }).first();
    expect(row).toBeTruthy(); // still present
  });

  // ── Tenant scoping ───────────────────────────────────────────────────────────

  it('does not surface an ad-hoc item created under tenant A when read under tenant B', async () => {
    const created = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Tenant A only' });

    // Same entry id, different tenant → the tenant-scoped WHERE finds nothing.
    await expect(
      getAdHocActivityForApi(ctx.user, OTHER_TENANT_ID, created.id),
    ).rejects.toThrow(/not found/i);

    // Sanity: it IS found under the owning tenant.
    const details = await getAdHocActivityForApi(ctx.user, tenantId, created.id);
    expect(details.entry_id).toBe(created.id);
    expect(details.assigned_user_ids).toEqual([userId]);
  });

  // ── Unified list (fetchUserActivitiesForApi) ─────────────────────────────────

  it('lists ad-hoc activities, paginates, and respects the open/closed filter', async () => {
    // Restrict the fan-out to the schedule source (ad-hoc items surface through it
    // regardless of the date window), keeping the assertion deterministic.
    const onlySchedule = { types: [ActivityType.SCHEDULE] };

    const a = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'List item A' });
    const b = await createAdHocActivityForApi(ctx.user, tenantId, { title: 'List item B' });

    const all = await fetchUserActivitiesForApi(ctx.user, tenantId, onlySchedule, 1, 25);
    const titles = all.activities.map((x) => x.title);
    expect(titles).toEqual(expect.arrayContaining(['List item A', 'List item B']));
    expect(all.totalCount).toBe(2);
    expect(all.pageNumber).toBe(1);
    expect(all.pageSize).toBe(25);

    // Pagination: one item per page across two pages.
    const page1 = await fetchUserActivitiesForApi(ctx.user, tenantId, onlySchedule, 1, 1);
    expect(page1.activities).toHaveLength(1);
    expect(page1.totalCount).toBe(2);
    expect(page1.pageCount).toBe(2);

    // Open/closed filter: mark A done → only B remains when filtering to open items.
    await setAdHocActivityDoneForApi(ctx.user, tenantId, a.id, true);
    const openOnly = await fetchUserActivitiesForApi(
      ctx.user,
      tenantId,
      { ...onlySchedule, isClosed: false },
      1,
      25,
    );
    const openTitles = openOnly.activities.map((x) => x.title);
    expect(openTitles).toContain('List item B');
    expect(openTitles).not.toContain('List item A');
    void b;
  });

  // ── Grouped view (fetchUserActivitiesGroupedForApi) ──────────────────────────

  it('groups ad-hoc activities by type with a single counted schedule bucket', async () => {
    const onlySchedule = { types: [ActivityType.SCHEDULE] };
    await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Group item A' });
    await createAdHocActivityForApi(ctx.user, tenantId, { title: 'Group item B' });

    const grouped = await fetchUserActivitiesGroupedForApi(ctx.user, tenantId, onlySchedule, 'type');

    expect(grouped.groupBy).toBe('type');
    expect(grouped.totalCount).toBe(2);
    expect(grouped.truncated).toBe(false);

    // All ad-hoc items are schedule-typed → exactly one bucket, keyed by the type, count 2.
    expect(grouped.groups).toHaveLength(1);
    const [bucket] = grouped.groups;
    expect(bucket.key).toBe(ActivityType.SCHEDULE);
    expect(bucket.count).toBe(2);
    expect(bucket.activities).toHaveLength(2);
    expect(bucket.activities.map((x) => x.title)).toEqual(
      expect.arrayContaining(['Group item A', 'Group item B']),
    );
  });

  it('buckets by due date, placing dateless ad-hoc items in the "none" group', async () => {
    const onlySchedule = { types: [ActivityType.SCHEDULE] };
    // Ad-hoc items created without times carry no due date.
    await createAdHocActivityForApi(ctx.user, tenantId, { title: 'No-due item' });

    const grouped = await fetchUserActivitiesGroupedForApi(ctx.user, tenantId, onlySchedule, 'dueDate');

    const none = grouped.groups.find((g) => g.key === 'none');
    expect(none).toBeDefined();
    expect(none!.activities.map((x) => x.title)).toContain('No-due item');
  });

  // ── Schedule fetch core (identity-explicit, no session) ──────────────────────

  it('getScheduleActivityEntriesForUser surfaces a windowed entry from (tenant, userId) alone', async () => {
    // Regression guard for the API-key path: the schedule fetch must NOT depend on a session.
    // It previously went through the withAuth `getScheduleActivityEntries`, which resolves the
    // NextAuth user — null under API-key auth — so it threw and the aggregation silently
    // dropped every schedule + ad-hoc item. This core takes the identity explicitly instead.
    const start = new Date('2030-03-01T00:00:00.000Z');
    const end = new Date('2030-03-31T23:59:59.999Z');
    await createAdHocActivityForApi(ctx.user, tenantId, {
      title: 'Timed schedule item',
      scheduledStart: '2030-03-10T09:00:00.000Z',
      scheduledEnd: '2030-03-10T10:00:00.000Z',
    });

    // No auth/session context is established — purely (tenant, userId, window).
    const entries = await getScheduleActivityEntriesForUser(tenantId, userId, start, end);
    expect(entries.map((e) => e.title)).toContain('Timed schedule item');
    // Every returned entry is assigned to the requested user.
    for (const entry of entries) {
      expect(entry.assigned_user_ids).toContain(userId);
    }
  });

  // ── The API-key bridge (route-level) ─────────────────────────────────────────

  it('rejects an activities request with neither session nor API key (401)', async () => {
    // No session: getCurrentUser (re-exported from the globally-mocked @alga-psa/auth)
    // returns null, and there is no x-api-key header.
    vi.mocked(getCurrentUser).mockResolvedValue(null as any);

    const res = await listActivitiesHandler(jsonRequest('GET', `${origin}/api/v1/activities`));
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('resolves a real x-api-key (no session) to the key owner and creates a self-assigned ad-hoc (201)', async () => {
    // Force the API-key branch of resolveActivityAuthContext by clearing the session user.
    vi.mocked(getCurrentUser).mockResolvedValue(null as any);

    const key = await createTestApiKey(ctx.db, userId, tenantId);

    const title = 'Created via API key';
    const res = await createAdHocHandler(
      jsonRequest('POST', `${origin}/api/v1/activities/ad-hoc`, { title }, { 'x-api-key': key.api_key }),
    );

    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.data.title).toBe(title);

    // Identity proof: the created item is owned by the API key's user, not the
    // setup.ts default mock user.
    const row = await findAdHocByTitle(title);
    expect(row).toBeTruthy();
    const assignees = await ctx.db('schedule_entry_assignees')
      .where({ tenant: tenantId, entry_id: row.entry_id })
      .pluck('user_id');
    expect(assignees).toEqual([userId]);
  });

  it('rejects an ad-hoc create with an invalid API key (401)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as any);

    const res = await createAdHocHandler(
      jsonRequest(
        'POST',
        `${origin}/api/v1/activities/ad-hoc`,
        { title: 'nope' },
        { 'x-api-key': 'definitely-not-a-real-key' },
      ),
    );
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // ── Custom groups (read-only) — backs GET /api/v1/activities/groups + mobile "My groups" ──

  it("returns the user's custom groups in sort order, with items ordered within each group", async () => {
    const [g1] = await ctx.db('user_activity_groups')
      .insert({ tenant: tenantId, user_id: userId, group_name: 'First', sort_order: 0 })
      .returning('group_id');
    const [g2] = await ctx.db('user_activity_groups')
      .insert({ tenant: tenantId, user_id: userId, group_name: 'Second', sort_order: 1, is_collapsed: true })
      .returning('group_id');
    const g1id = (g1 as any).group_id ?? g1;

    // Insert items out of order to prove they come back ordered by sort_order.
    await ctx.db('user_activity_group_items').insert([
      { tenant: tenantId, group_id: g1id, activity_id: 'act-2', activity_type: 'ticket', sort_order: 1 },
      { tenant: tenantId, group_id: g1id, activity_id: 'act-1', activity_type: 'workflowTask', sort_order: 0 },
    ]);
    void g2;

    const groups = await getUserActivityGroupsForApi(ctx.user, tenantId);

    expect(groups.map((g) => g.groupName)).toEqual(['First', 'Second']);
    expect(groups[0].items.map((i) => i.activityId)).toEqual(['act-1', 'act-2']);
    expect(groups[0].items[0].activityType).toBe('workflowTask');
    expect(groups[1].isCollapsed).toBe(true);
    expect(groups[1].items).toEqual([]);
  });

  it('returns an empty array when the user has no groups', async () => {
    const groups = await getUserActivityGroupsForApi(ctx.user, tenantId);
    expect(groups).toEqual([]);
  });

  it("throws Permission denied when viewing another user's groups without the capability", async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await expect(
      getUserActivityGroupsForApi(ctx.user, tenantId, randomUUID()),
    ).rejects.toThrow(/permission denied/i);
  });

  // ── Custom group organization (move / remove / reorder) — backs mobile drag-to-organize ──

  async function createGroup(name: string, sortOrder = 0, isCollapsed = false): Promise<string> {
    const [row] = await ctx.db('user_activity_groups')
      .insert({ tenant: tenantId, user_id: userId, group_name: name, sort_order: sortOrder, is_collapsed: isCollapsed })
      .returning('group_id');
    return (row as any).group_id ?? row;
  }

  async function groupItemIds(groupId: string): Promise<string[]> {
    return ctx.db('user_activity_group_items')
      .where({ tenant: tenantId, group_id: groupId })
      .orderBy('sort_order')
      .pluck('activity_id');
  }

  it('moves an activity into a group, persisting the membership row at the given sort order', async () => {
    const gid = await createGroup('Inbox');

    await moveActivityToGroupForApi(ctx.user, tenantId, 'tk-1', 'ticket', gid, 0);

    const rows = await ctx.db('user_activity_group_items').where({ tenant: tenantId, group_id: gid });
    expect(rows).toHaveLength(1);
    expect(rows[0].activity_id).toBe('tk-1');
    expect(rows[0].activity_type).toBe('ticket');
    expect(rows[0].sort_order).toBe(0);
  });

  it('shifts existing rows up when inserting at an occupied index (keeps sort_order dense + unique)', async () => {
    const gid = await createGroup('Inbox');
    await moveActivityToGroupForApi(ctx.user, tenantId, 'x', 'ticket', gid, 0);
    await moveActivityToGroupForApi(ctx.user, tenantId, 'y', 'ticket', gid, 1);

    // Insert z at index 1 → y is pushed to index 2.
    await moveActivityToGroupForApi(ctx.user, tenantId, 'z', 'ticket', gid, 1);

    expect(await groupItemIds(gid)).toEqual(['x', 'z', 'y']);
  });

  it('removes an activity from its previous group when moved to another (at most one group)', async () => {
    const g1 = await createGroup('One', 0);
    const g2 = await createGroup('Two', 1);
    await moveActivityToGroupForApi(ctx.user, tenantId, 'tk-1', 'ticket', g1, 0);

    await moveActivityToGroupForApi(ctx.user, tenantId, 'tk-1', 'ticket', g2, 0);

    expect(await groupItemIds(g1)).toEqual([]);
    expect(await groupItemIds(g2)).toEqual(['tk-1']);
  });

  it('throws Target group not found for an unknown / other-user group', async () => {
    await expect(
      moveActivityToGroupForApi(ctx.user, tenantId, 'tk-1', 'ticket', randomUUID(), 0),
    ).rejects.toThrow(/target group not found/i);
  });

  it('denies move when the caller lacks user_schedule:read', async () => {
    const gid = await createGroup('Inbox');
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(
      moveActivityToGroupForApi(ctx.user, tenantId, 'tk-1', 'ticket', gid, 0),
    ).rejects.toThrow(/permission denied/i);
    expect(await groupItemIds(gid)).toEqual([]); // nothing persisted
  });

  it('removes an activity from all of the caller\'s groups (ungroup)', async () => {
    const gid = await createGroup('Inbox');
    await moveActivityToGroupForApi(ctx.user, tenantId, 'tk-1', 'ticket', gid, 0);

    await removeActivityFromGroupsForApi(ctx.user, tenantId, 'tk-1', 'ticket');

    expect(await groupItemIds(gid)).toEqual([]);
  });

  it('remove is a no-op (no throw) when the caller has no groups', async () => {
    await expect(
      removeActivityFromGroupsForApi(ctx.user, tenantId, 'tk-1', 'ticket'),
    ).resolves.toBeUndefined();
  });

  it('reorders a group to the supplied order', async () => {
    const gid = await createGroup('Inbox');
    await moveActivityToGroupForApi(ctx.user, tenantId, 'a', 'ticket', gid, 0);
    await moveActivityToGroupForApi(ctx.user, tenantId, 'b', 'ticket', gid, 1);
    await moveActivityToGroupForApi(ctx.user, tenantId, 'c', 'ticket', gid, 2);

    await reorderActivitiesInGroupForApi(ctx.user, tenantId, gid, [
      { activityId: 'c', activityType: 'ticket', sortOrder: 0 },
      { activityId: 'a', activityType: 'ticket', sortOrder: 1 },
      { activityId: 'b', activityType: 'ticket', sortOrder: 2 },
    ]);

    expect(await groupItemIds(gid)).toEqual(['c', 'a', 'b']);
  });

  it('throws Group not found when reordering an unknown group', async () => {
    await expect(
      reorderActivitiesInGroupForApi(ctx.user, tenantId, randomUUID(), [
        { activityId: 'a', activityType: 'ticket', sortOrder: 0 },
      ]),
    ).rejects.toThrow(/group not found/i);
  });

  // ── Route layer (HTTP + API-key bridge + validation) ─────────────────────────

  it('POST /activities/groups/items moves via a real x-api-key (200) and persists the row', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as any);
    const key = await createTestApiKey(ctx.db, userId, tenantId);
    const gid = await createGroup('Inbox');

    const res = await moveGroupItemHandler(
      jsonRequest(
        'POST',
        `${origin}/api/v1/activities/groups/items`,
        { activityId: 'tk-1', activityType: 'ticket', groupId: gid, sortOrder: 0 },
        { 'x-api-key': key.api_key },
      ),
    );

    expect(res.status).toBe(200);
    expect(await groupItemIds(gid)).toEqual(['tk-1']);
  });

  it('POST /activities/groups/items rejects a malformed body (400)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as any);
    const key = await createTestApiKey(ctx.db, userId, tenantId);

    const res = await moveGroupItemHandler(
      jsonRequest(
        'POST',
        `${origin}/api/v1/activities/groups/items`,
        { activityId: 'tk-1' }, // missing activityType / groupId / sortOrder
        { 'x-api-key': key.api_key },
      ),
    );

    expect(res.status).toBe(400);
  });

  it('DELETE /activities/groups/items ungroups via the route (200)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as any);
    const key = await createTestApiKey(ctx.db, userId, tenantId);
    const gid = await createGroup('Inbox');
    await moveActivityToGroupForApi(ctx.user, tenantId, 'tk-1', 'ticket', gid, 0);

    const res = await removeGroupItemHandler(
      jsonRequest(
        'DELETE',
        `${origin}/api/v1/activities/groups/items`,
        { activityId: 'tk-1', activityType: 'ticket' },
        { 'x-api-key': key.api_key },
      ),
    );

    expect(res.status).toBe(200);
    expect(await groupItemIds(gid)).toEqual([]);
  });

  it('PATCH /activities/groups/{groupId}/items reorders via the route (200)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as any);
    const key = await createTestApiKey(ctx.db, userId, tenantId);
    const gid = await createGroup('Inbox');
    await moveActivityToGroupForApi(ctx.user, tenantId, 'a', 'ticket', gid, 0);
    await moveActivityToGroupForApi(ctx.user, tenantId, 'b', 'ticket', gid, 1);

    const res = await reorderGroupItemsHandler(
      jsonRequest(
        'PATCH',
        `${origin}/api/v1/activities/groups/${gid}/items`,
        {
          items: [
            { activityId: 'b', activityType: 'ticket', sortOrder: 0 },
            { activityId: 'a', activityType: 'ticket', sortOrder: 1 },
          ],
        },
        { 'x-api-key': key.api_key },
      ),
      { params: Promise.resolve({ groupId: gid }) },
    );

    expect(res.status).toBe(200);
    expect(await groupItemIds(gid)).toEqual(['b', 'a']);
  });
});
