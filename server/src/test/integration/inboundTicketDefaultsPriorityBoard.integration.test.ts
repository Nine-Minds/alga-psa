/**
 * T034–T036, T038–T041 — F016 and F018 of `ee/plans/2026-11-21-itil-remediation` (`email-hotfix`).
 *
 * Inbound email creates every ticket on a board with the priority stored in that board's defaults
 * row. Saving the row refuses a priority the board does not offer (R3, R6 refuse side), and the
 * email path falls back to the board's default rather than dropping the email (R6 fall-back side).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import {
  createInboundTicketDefaults,
  updateInboundTicketDefaults,
  getInboundTicketDefaults,
} from '../../../../packages/integrations/src/actions/email-actions/inboundTicketDefaultsActions';
import { resolveTicketPriorityFields } from '@alga-psa/shared/lib/tickets/boardFieldRules';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tt(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tt(tenantId, 'inbound_ticket_defaults').del();
  await tt(tenantId, 'tickets').del();
  await tt(tenantId, 'clients').del();
  await tt(tenantId, 'boards').update({ default_priority_id: null });
  await tt(tenantId, 'priorities').del();
  await tt(tenantId, 'statuses').del();
  await tt(tenantId, 'boards').del();
  await tt(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

interface Fixture {
  tenantId: string;
  userId: string;
  clientId: string;
  ownBoardId: string;
  itilBoardId: string;
  ownStatusId: string;
  itilStatusId: string;
  ownPriorityId: string;
  itilPriorityIds: Record<number, string>;
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const ownBoardId = uuidv4();
  const itilBoardId = uuidv4();
  const ownStatusId = uuidv4();
  const itilStatusId = uuidv4();
  const ownPriorityId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });

  await tt(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });

  await tt(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Catch-all client',
  });

  await tt(tenantId, 'boards').insert([
    {
      tenant: tenantId,
      board_id: ownBoardId,
      board_name: 'General',
      display_order: 10,
      is_default: true,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
    },
    {
      tenant: tenantId,
      board_id: itilBoardId,
      board_name: 'ITIL Service Desk',
      display_order: 20,
      is_default: false,
      is_inactive: false,
      category_type: 'itil',
      priority_type: 'itil',
    },
  ]);

  await tt(tenantId, 'statuses').insert([
    {
      tenant: tenantId,
      status_id: ownStatusId,
      name: 'New',
      board_id: ownBoardId,
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 1,
      created_by: userId,
    },
    {
      tenant: tenantId,
      status_id: itilStatusId,
      name: 'New',
      board_id: itilBoardId,
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 1,
      created_by: userId,
    },
  ]);

  await tt(tenantId, 'priorities').insert({
    tenant: tenantId,
    priority_id: ownPriorityId,
    priority_name: 'Normal',
    color: '#111111',
    order_number: 5,
    item_type: 'ticket',
    is_from_itil_standard: false,
    created_by: userId,
  });

  const itilPriorityIds: Record<number, string> = {};
  await tt(tenantId, 'priorities').insert(
    [1, 2, 3, 4, 5].map((level) => {
      const priorityId = uuidv4();
      itilPriorityIds[level] = priorityId;
      return {
        tenant: tenantId,
        priority_id: priorityId,
        priority_name: `P${level} - ITIL`,
        color: '#DC2626',
        order_number: 99 + level,
        item_type: 'ticket',
        is_from_itil_standard: true,
        itil_priority_level: level,
        created_by: userId,
      };
    })
  );

  dbRef.knex = db;
  dbRef.tenant = tenantId;
  userRef.user = { user_id: userId, user_type: 'internal', tenant: tenantId };

  return {
    tenantId,
    userId,
    clientId,
    ownBoardId,
    itilBoardId,
    ownStatusId,
    itilStatusId,
    ownPriorityId,
    itilPriorityIds,
  };
}

function payloadFor(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    short_name: `catch-all-${uuidv4().slice(0, 8)}`,
    display_name: 'Catch All Defaults',
    board_id: fixture.ownBoardId,
    status_id: fixture.ownStatusId,
    priority_id: fixture.ownPriorityId,
    client_id: fixture.clientId,
    is_active: true,
    ...overrides,
  } as any;
}

/** Inserts a defaults row straight into the table, as one saved before the rule existed. */
async function insertStoredDefaults(fixture: Fixture, boardId: string, statusId: string, priorityId: string) {
  const id = uuidv4();
  await tt(fixture.tenantId, 'inbound_ticket_defaults').insert({
    id,
    tenant: fixture.tenantId,
    short_name: `legacy-${id.slice(0, 8)}`,
    display_name: 'Legacy Defaults',
    description: 'Saved before the rule existed',
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    client_id: fixture.clientId,
    is_active: true,
  });
  return id;
}

describe('inbound ticket defaults priority vs board (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T034: refuses a wrong-family priority on create and stores nothing', async () => {
    const fixture = await createFixture();

    const result: any = await createInboundTicketDefaults(
      payloadFor(fixture, {
        board_id: fixture.itilBoardId,
        status_id: fixture.itilStatusId,
        priority_id: fixture.ownPriorityId,
      })
    );

    expect(result.actionError).toContain('Normal');
    expect(result.actionError).toContain('ITIL Service Desk');
    expect(result.messageKey).toBe('features/tickets:errors.ticket.priorityCustomBoardItil');
    const rows = await tt(fixture.tenantId, 'inbound_ticket_defaults').select('id');
    expect(rows).toEqual([]);
  });

  it('T035: refuses a priority that no longer exists', async () => {
    const fixture = await createFixture();

    const result: any = await createInboundTicketDefaults(
      payloadFor(fixture, { priority_id: uuidv4() })
    );

    expect(result.actionError).toContain('priority no longer exists');
    expect(result.messageKey).toBe('msp/email-providers:errors.inboundDefaults.priorityNotValidForBoard');
    expect(await tt(fixture.tenantId, 'inbound_ticket_defaults').select('id')).toEqual([]);
  });

  it('T036: refuses a description-only save of a stored row whose priority does not fit', async () => {
    const fixture = await createFixture();
    const id = await insertStoredDefaults(
      fixture,
      fixture.itilBoardId,
      fixture.itilStatusId,
      fixture.ownPriorityId
    );

    const result: any = await updateInboundTicketDefaults(id, { description: 'Just a note' });

    expect(result.actionError).toContain('Normal');
    expect(result.messageKey).toBe('features/tickets:errors.ticket.priorityCustomBoardItil');
    const row = await tt(fixture.tenantId, 'inbound_ticket_defaults').where({ id }).first('description');
    expect(row.description).toBe('Saved before the rule existed');

    // Fixing the priority saves the description with it.
    const fixed: any = await updateInboundTicketDefaults(id, {
      description: 'Just a note',
      priority_id: fixture.itilPriorityIds[3],
    });
    expect(fixed.defaults.description).toBe('Just a note');
    expect(fixed.defaults.priority_id).toBe(fixture.itilPriorityIds[3]);
  });

  it('T037: the list reports which stored rows hold a priority their board does not offer', async () => {
    const fixture = await createFixture();
    const mismatched = await insertStoredDefaults(
      fixture,
      fixture.itilBoardId,
      fixture.itilStatusId,
      fixture.ownPriorityId
    );
    const fitting = await insertStoredDefaults(
      fixture,
      fixture.ownBoardId,
      fixture.ownStatusId,
      fixture.ownPriorityId
    );

    const result: any = await getInboundTicketDefaults();

    expect(result.priorityMismatchIds).toEqual([mismatched]);
    expect(result.defaults.map((row: any) => row.id).sort()).toEqual([mismatched, fitting].sort());
  });

  describe('inbound email falls back instead of dropping the ticket (F018)', () => {
    it('T038: a fitting configured priority is used as it stands', async () => {
      const fixture = await createFixture();

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.itilPriorityIds[2],
        policy: 'fallback',
      });

      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[2]);
      expect(resolved.problems).toEqual([]);
    });

    it('T039: a non-fitting configured priority falls back to the board default', async () => {
      const fixture = await createFixture();
      await tt(fixture.tenantId, 'boards')
        .where({ board_id: fixture.itilBoardId })
        .update({ default_priority_id: fixture.itilPriorityIds[4] });

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.ownPriorityId,
        policy: 'fallback',
      });

      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[4]);
      expect(resolved.problems).toEqual([]);
    });

    it('T040: with no fitting priority in the tenant the configured one is kept', async () => {
      const fixture = await createFixture();
      await tt(fixture.tenantId, 'priorities').where({ is_from_itil_standard: true }).del();

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.ownPriorityId,
        policy: 'fallback',
      });

      expect(resolved.priority_id).toBe(fixture.ownPriorityId);
      expect(resolved.problems).toEqual([]);
    });

    it('T041: a deleted configured priority falls back to the board default', async () => {
      const fixture = await createFixture();

      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: uuidv4(),
        policy: 'fallback',
      });

      // No board default is stored, so R7 gives the level-3 ITIL priority.
      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[3]);
      expect(resolved.problems).toEqual([]);
    });
  });
});
