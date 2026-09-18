import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEventMock = vi.hoisted(() =>
  vi.fn<typeof import('server/src/lib/eventBus/publishers').publishWorkflowEvent>(async () => undefined)
);

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

// BaseService (the TicketService base) imports createTenantKnex from the
// internal tenant module, not the @alga-psa/db barrel, so the barrel mock
// above never intercepts it. Mock the same resolved module to point the
// service at the suite's tenant/db handle while keeping real withTransaction.
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
}));

// TicketService uses the server-local publisher. Capture delivery at that
// boundary so the service still exercises its workflow-event behavior.
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import {
  evaluateTicketCloseRules,
  enforceTicketCloseRules,
  TicketCloseValidationError,
} from '../../../../packages/tickets/src/lib/validateTicketClosure';
import {
  getBoardCloseRules,
  upsertBoardCloseRules,
  createBoardAutoCloseRule,
  checkTicketClosure,
} from '../../../../packages/tickets/src/actions/close-rules/closeRuleActions';
import { updateTicketInTransaction } from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import { TicketService } from '../../lib/api/services/TicketService';
import { ValidationError } from '../../lib/api/middleware/apiMiddleware';
import { tenantDb } from '@alga-psa/db';
import { createCloseRulesFixture, insertTicket, type CloseRulesFixture } from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let fixture: CloseRulesFixture;

/**
 * The REST ticket surface is what the mobile app and public API use. It must
 * treat bundles the way the web update action does: the list can collapse
 * children under their master, rows/detail carry the bundle columns, children
 * cannot change workflow fields, and a sync_updates master cascades.
 */
describe('REST TicketService bundle parity with the web', () => {
  const serviceContext = () =>
    ({ tenant: fixture.tenantId, userId: fixture.userId, user: userRef.user }) as any;

  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of seeded internal user for bundle parity integration')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    dbRef.tenant = seededUser.tenant;
    userRef.user = {
      user_id: seededUser.user_id,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
    };

    fixture = await createCloseRulesFixture(db, seededUser.tenant, seededUser.user_id);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  async function seedBundle(mode: 'sync_updates' | 'link_only') {
    const service = new TicketService();
    const masterId = await insertTicket(db, fixture);
    const childA = await insertTicket(db, fixture);
    const childB = await insertTicket(db, fixture);
    await service.bundleTickets(serviceContext(), { masterTicketId: masterId, childTicketIds: [childA, childB], mode });
    return { service, masterId, childA, childB };
  }

  it('bundled list view hides children and carries bundle columns on the mobile projection', async () => {
    const { service, masterId, childA, childB } = await seedBundle('sync_updates');
    const master = await tenantDb(db, fixture.tenantId).table('tickets').where({ ticket_id: masterId }).first();

    const bundled = await service.list(
      { page: 1, limit: 100, filters: { board_id: fixture.boardId, bundle_view: 'bundled' } as any, fields: ['mobile_list'] },
      serviceContext()
    );
    const bundledIds = bundled.data.map((row: any) => row.ticket_id);
    expect(bundledIds).toContain(masterId);
    expect(bundledIds).not.toContain(childA);
    expect(bundledIds).not.toContain(childB);
    const masterRow: any = bundled.data.find((row: any) => row.ticket_id === masterId);
    expect(masterRow.bundle_child_count).toBe(2);
    expect(masterRow.master_ticket_id).toBeNull();

    const individual = await service.list(
      { page: 1, limit: 100, filters: { board_id: fixture.boardId, bundle_view: 'individual' } as any, fields: ['mobile_list'] },
      serviceContext()
    );
    const childRow: any = individual.data.find((row: any) => row.ticket_id === childA);
    expect(childRow).toBeTruthy();
    expect(childRow.master_ticket_id).toBe(masterId);
    expect(childRow.bundle_master_ticket_number).toBe(master.ticket_number);
    expect(childRow.bundle_child_count).toBe(0);

    // Omitting the filter keeps the historical (individual) result set.
    const legacy = await service.list(
      { page: 1, limit: 100, filters: { board_id: fixture.boardId } as any },
      serviceContext()
    );
    expect(legacy.data.map((row: any) => row.ticket_id)).toContain(childB);
  });

  it('detail carries the master number for children and the child count for masters', async () => {
    const { service, masterId, childA } = await seedBundle('sync_updates');
    const master = await tenantDb(db, fixture.tenantId).table('tickets').where({ ticket_id: masterId }).first();

    const child: any = await service.getById(childA, serviceContext());
    expect(child.master_ticket_id).toBe(masterId);
    expect(child.bundle_master_ticket_number).toBe(master.ticket_number);

    const masterDetail: any = await service.getById(masterId, serviceContext());
    expect(masterDetail.bundle_child_count).toBe(2);
    expect(masterDetail.bundle_master_ticket_number).toBeNull();
  });

  it('children reject workflow-field changes with the web lock message', async () => {
    const { service, childA } = await seedBundle('sync_updates');

    const rejection = await service.update(childA, { status_id: fixture.closedStatusId }, serviceContext())
      .then(() => null, (error: unknown) => error);
    expect(rejection).toBeInstanceOf(ValidationError);
    expect((rejection as ValidationError).details).toEqual([
      expect.objectContaining({ path: ['status_id'], message: expect.stringMatching(/workflow fields are locked \(status_id\)/) }),
    ]);

    // Unchanged workflow values are not an attempt; only assigned_to moves here.
    const assignRejection = await service.update(childA, { priority_id: fixture.priorityId, assigned_to: fixture.userId }, serviceContext())
      .then(() => null, (error: unknown) => error);
    expect((assignRejection as ValidationError).details).toEqual([
      expect.objectContaining({ path: ['assigned_to'] }),
    ]);

    // Non-workflow fields stay editable on a child.
    const renamed = await service.update(childA, { title: 'Child renamed via REST' }, serviceContext());
    expect(renamed.title).toBe('Child renamed via REST');

    const after = await tenantDb(db, fixture.tenantId).table('tickets').where({ ticket_id: childA }).first();
    expect(after.status_id).toBe(fixture.openStatusId);
  });

  it('closing a sync_updates master through REST cascades to its children', async () => {
    const { service, masterId, childA, childB } = await seedBundle('sync_updates');

    await service.update(masterId, { status_id: fixture.closedStatusId }, serviceContext());

    const scoped = tenantDb(db, fixture.tenantId);
    for (const childId of [childA, childB]) {
      const child = await scoped.table('tickets').where({ ticket_id: childId }).first();
      expect(child.status_id).toBe(fixture.closedStatusId);
      expect(child.is_closed).toBe(true);
      expect(child.closed_at).not.toBeNull();
      expect(child.closed_by).toBe(fixture.userId);
    }

    // Reopening cascades the cleared closure state too.
    await service.update(masterId, { status_id: fixture.openStatusId }, serviceContext());
    const reopened = await scoped.table('tickets').where({ ticket_id: childA }).first();
    expect(reopened.status_id).toBe(fixture.openStatusId);
    expect(reopened.is_closed).toBe(false);
    expect(reopened.closed_at).toBeNull();
  });

  it('link_only masters do not cascade', async () => {
    const { service, masterId, childA } = await seedBundle('link_only');

    await service.update(masterId, { status_id: fixture.closedStatusId }, serviceContext());

    const child = await tenantDb(db, fixture.tenantId).table('tickets').where({ ticket_id: childA }).first();
    expect(child.status_id).toBe(fixture.openStatusId);
    expect(child.is_closed).toBe(false);
  });
});
