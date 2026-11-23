/**
 * T119–T132 — F061–F067 of `ee/plans/2026-11-21-itil-remediation` (`impact-urgency`).
 *
 * The Impact × Urgency rule (R4) and the D5 clearing as the MSP create and update paths now apply
 * them: through `resolveTicketPriorityFieldsOrThrow` for a create and `prepareTicketFieldPatchOrThrow`
 * for a patch, both of which delegate to the shared rules module. The wiring — that each named
 * writer calls them and that no `P{n} -` name lookup is left — is pinned by
 * `server/src/test/unit/itilImpactUrgencyContract.test.ts`; this file is the behaviour.
 *
 * Each test builds its own tenant, as `itilBoardFieldRules.integration.test.ts` does, so the rows
 * under test are exactly the ones it inserted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  preCheckDeletion: vi.fn(async () => ({ allowed: true })),
}));

import {
  itilPriorityLevelForPriority,
  resolveTicketPriorityFields,
} from '@alga-psa/shared/lib/tickets/boardFieldRules';
import {
  resolveTicketPriorityFieldsOrThrow,
  prepareTicketFieldPatchOrThrow,
  TicketBoardFieldError,
} from '../../../../packages/tickets/src/lib/ticketFieldReferences';

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
  /** A board with ITIL priorities and one with the tenant's own. */
  itilBoardId: string;
  ownBoardId: string;
  itilPriorityIds: Record<number, string>;
  ownPriorityIds: string[];
}

/**
 * A tenant with both board kinds, the five ITIL priorities keyed by level and two of the tenant's
 * own. The ITIL names deliberately do *not* follow the `P{n} - …` shape the removed lookup matched,
 * so a test that passes here cannot be passing by name (T122's behavioural half).
 */
async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
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

  const itilBoardId = uuidv4();
  const ownBoardId = uuidv4();
  await tt(tenantId, 'boards').insert([
    {
      tenant: tenantId,
      board_id: itilBoardId,
      board_name: 'ITIL Service Desk',
      display_order: 10,
      is_default: true,
      is_inactive: false,
      category_type: 'itil',
      priority_type: 'itil',
    },
    {
      tenant: tenantId,
      board_id: ownBoardId,
      board_name: 'Own Work',
      display_order: 20,
      is_default: false,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
    },
  ]);

  const itilPriorityIds: Record<number, string> = {};
  await tt(tenantId, 'priorities').insert(
    [1, 2, 3, 4, 5].map((level) => {
      const priorityId = uuidv4();
      itilPriorityIds[level] = priorityId;
      return {
        tenant: tenantId,
        priority_id: priorityId,
        priority_name: `ITIL level ${level} (renamed)`,
        color: '#DC2626',
        order_number: 100 + level,
        item_type: 'ticket',
        is_from_itil_standard: true,
        itil_priority_level: level,
        created_by: userId,
      };
    })
  );

  const ownPriorityIds = [uuidv4(), uuidv4()];
  await tt(tenantId, 'priorities').insert(
    ownPriorityIds.map((priorityId, index) => ({
      tenant: tenantId,
      priority_id: priorityId,
      priority_name: index === 0 ? 'Routine' : 'Rush',
      color: '#111111',
      order_number: index + 1,
      item_type: 'ticket',
      is_from_itil_standard: false,
      created_by: userId,
    }))
  );

  dbRef.knex = db;
  dbRef.tenant = tenantId;
  userRef.user = { user_id: userId, user_type: 'internal', tenant: tenantId };

  return { tenantId, userId, itilBoardId, ownBoardId, itilPriorityIds, ownPriorityIds };
}

describe('ITIL Impact × Urgency (integration)', () => {
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

  describe('create (F061)', () => {
    it('T119: on an ITIL board Impact and Urgency decide the priority and both are stored', async () => {
      const fixture = await createFixture();

      // Impact 1 × Urgency 2 is level 2 in the matrix. The submitted priority is ignored (R4).
      const resolved = await resolveTicketPriorityFieldsOrThrow(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.itilPriorityIds[5],
        itilImpact: 1,
        itilUrgency: 2,
        policy: 'refuse',
      });

      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[2]);
      expect(resolved.itil_impact).toBe(1);
      expect(resolved.itil_urgency).toBe(2);
    }, HOOK_TIMEOUT);

    it('T120: on a board with the tenant’s own priorities neither value is stored', async () => {
      const fixture = await createFixture();

      // The form can still submit the pair (one board switch away); it is not stored and the
      // selected priority stands.
      const resolved = await resolveTicketPriorityFieldsOrThrow(db, fixture.tenantId, {
        boardId: fixture.ownBoardId,
        priorityId: fixture.ownPriorityIds[1],
        itilImpact: 1,
        itilUrgency: 1,
        policy: 'refuse',
      });

      expect(resolved.priority_id).toBe(fixture.ownPriorityIds[1]);
      expect(resolved.itil_impact).toBeNull();
      expect(resolved.itil_urgency).toBeNull();
    }, HOOK_TIMEOUT);

    it('T125: Impact with no Urgency on an ITIL board is refused with a field error', async () => {
      const fixture = await createFixture();

      const error = await resolveTicketPriorityFieldsOrThrow(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.itilPriorityIds[3],
        itilImpact: 2,
        itilUrgency: null,
        policy: 'refuse',
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TicketBoardFieldError);
      expect((error as TicketBoardFieldError).field).toBe('itil_urgency');
      expect((error as TicketBoardFieldError).messageKey).toBe(
        'features/tickets:errors.ticket.impactUrgencyTogether'
      );
    }, HOOK_TIMEOUT);

    it('T128: a duplicate copies a priority and an assessment that agree', async () => {
      const fixture = await createFixture();

      // The source carries level 5 with an assessment that computes level 1: the copy cannot keep
      // both, and the assessment wins (R4), so the three fields agree on the copy.
      const copy = await resolveTicketPriorityFieldsOrThrow(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.itilPriorityIds[5],
        itilImpact: 1,
        itilUrgency: 1,
        policy: 'refuse',
      });

      expect(copy.priority_id).toBe(fixture.itilPriorityIds[1]);
      expect(copy.itil_impact).toBe(1);
      expect(copy.itil_urgency).toBe(1);

      // A source with no assessment copies its priority and stays unassessed.
      const unassessed = await resolveTicketPriorityFieldsOrThrow(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.itilPriorityIds[4],
        itilImpact: null,
        itilUrgency: null,
        policy: 'refuse',
      });
      expect(unassessed).toMatchObject({
        priority_id: fixture.itilPriorityIds[4],
        itil_impact: null,
        itil_urgency: null,
      });
    }, HOOK_TIMEOUT);

    it('T126: a service request configured with Impact and Urgency gets the matrix priority by level', async () => {
      const fixture = await createFixture();

      // The provider's policy is fall-back (R6): nobody is watching the execution.
      const resolved = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.ownPriorityIds[0],
        itilImpact: 3,
        itilUrgency: 4,
        policy: 'fallback',
      });

      expect(resolved.problems).toEqual([]);
      expect(resolved.priority_id).toBe(fixture.itilPriorityIds[4]);
      expect(resolved.itil_impact).toBe(3);
      expect(resolved.itil_urgency).toBe(4);
    }, HOOK_TIMEOUT);
  });

  describe('update (F062, F063)', () => {
    it('T121: Impact alone on an assessed ticket recomputes from the new Impact and stored Urgency', async () => {
      const fixture = await createFixture();
      const current = {
        board_id: fixture.itilBoardId,
        priority_id: fixture.itilPriorityIds[3],
        itil_impact: 3,
        itil_urgency: 3,
      };

      const patch: Record<string, unknown> = { itil_impact: 1 };
      await prepareTicketFieldPatchOrThrow(db, fixture.tenantId, current, patch, 'refuse');

      // Impact 1 × stored Urgency 3 is level 2.
      expect(patch).toMatchObject({ priority_id: fixture.itilPriorityIds[2], itil_impact: 1 });
      expect(patch.itil_urgency === undefined || patch.itil_urgency === 3).toBe(true);
    }, HOOK_TIMEOUT);

    it('T123: a direct priority change on an assessed ticket clears Impact and Urgency (D5)', async () => {
      const fixture = await createFixture();
      const current = {
        board_id: fixture.itilBoardId,
        priority_id: fixture.itilPriorityIds[1],
        itil_impact: 1,
        itil_urgency: 1,
      };

      const patch: Record<string, unknown> = { priority_id: fixture.itilPriorityIds[5] };
      await prepareTicketFieldPatchOrThrow(db, fixture.tenantId, current, patch, 'refuse');

      // The chosen priority stands, and the pair that computed another one is gone: the ticket is
      // "Not assessed" rather than carrying values nobody chose.
      expect(patch).toEqual({
        priority_id: fixture.itilPriorityIds[5],
        itil_impact: null,
        itil_urgency: null,
      });
    }, HOOK_TIMEOUT);

    it('T124: a direct priority change on an unassessed ticket leaves the pair empty', async () => {
      const fixture = await createFixture();
      const current = {
        board_id: fixture.itilBoardId,
        priority_id: fixture.itilPriorityIds[3],
        itil_impact: null,
        itil_urgency: null,
      };

      const patch: Record<string, unknown> = { priority_id: fixture.itilPriorityIds[4] };
      await prepareTicketFieldPatchOrThrow(db, fixture.tenantId, current, patch, 'refuse');

      expect(patch).toEqual({ priority_id: fixture.itilPriorityIds[4] });
    }, HOOK_TIMEOUT);

    it('T132: choosing Impact and Urgency on an unassessed ticket saves the matrix priority', async () => {
      const fixture = await createFixture();
      const current = {
        board_id: fixture.itilBoardId,
        priority_id: fixture.itilPriorityIds[5],
        itil_impact: null,
        itil_urgency: null,
      };

      const patch: Record<string, unknown> = { itil_impact: 2, itil_urgency: 1 };
      await prepareTicketFieldPatchOrThrow(db, fixture.tenantId, current, patch, 'refuse');

      // Impact 2 × Urgency 1 is level 2.
      expect(patch).toMatchObject({
        priority_id: fixture.itilPriorityIds[2],
        itil_impact: 2,
        itil_urgency: 1,
      });
    }, HOOK_TIMEOUT);

    it('T123: an edit that touches neither the priority nor the board leaves all three alone', async () => {
      const fixture = await createFixture();
      const current = {
        board_id: fixture.itilBoardId,
        // A legacy ticket whose priority does not fit its board at all (R5/D3).
        priority_id: fixture.ownPriorityIds[0],
        itil_impact: 4,
        itil_urgency: 4,
      };

      const patch: Record<string, unknown> = { title: 'Renamed' };
      await prepareTicketFieldPatchOrThrow(db, fixture.tenantId, current, patch, 'refuse');

      expect(patch).toEqual({ title: 'Renamed' });

      // The detail form posts every field it holds, so re-sending the stored board, priority and
      // assessment is not a change either, and the legacy pair survives untouched.
      const resend: Record<string, unknown> = {
        board_id: fixture.itilBoardId,
        priority_id: fixture.ownPriorityIds[0],
        itil_impact: 4,
        itil_urgency: 4,
      };
      await prepareTicketFieldPatchOrThrow(db, fixture.tenantId, current, resend, 'refuse');
      expect(resend).toEqual({
        board_id: fixture.itilBoardId,
        priority_id: fixture.ownPriorityIds[0],
        itil_impact: 4,
        itil_urgency: 4,
      });
    }, HOOK_TIMEOUT);
  });

  describe('the level is read from the priority (F066, D8)', () => {
    it('T130: an ITIL priority answers with its level and any other priority with none', async () => {
      const fixture = await createFixture();

      for (const level of [1, 2, 3, 4, 5]) {
        expect(
          await itilPriorityLevelForPriority(db, fixture.tenantId, fixture.itilPriorityIds[level])
        ).toBe(level);
      }
      expect(await itilPriorityLevelForPriority(db, fixture.tenantId, fixture.ownPriorityIds[0])).toBeNull();
      expect(await itilPriorityLevelForPriority(db, fixture.tenantId, null)).toBeNull();
    }, HOOK_TIMEOUT);

    it('T129: no create or update writes tickets.itil_priority_level', async () => {
      const fixture = await createFixture();

      // Whatever a caller sends, the resolver answers with the three fields a write may store, and
      // a level is not one of them.
      const resolved = await resolveTicketPriorityFieldsOrThrow(db, fixture.tenantId, {
        boardId: fixture.itilBoardId,
        priorityId: fixture.itilPriorityIds[3],
        itilImpact: 1,
        itilUrgency: 1,
        policy: 'refuse',
      });
      expect(Object.keys(resolved).sort()).toEqual(['itil_impact', 'itil_urgency', 'priority_id', 'problems']);

      const patch: Record<string, unknown> = { priority_id: fixture.itilPriorityIds[2] };
      await prepareTicketFieldPatchOrThrow(
        db,
        fixture.tenantId,
        { board_id: fixture.itilBoardId, priority_id: fixture.itilPriorityIds[3] },
        patch,
        'refuse'
      );
      expect(Object.keys(patch)).not.toContain('itil_priority_level');
    }, HOOK_TIMEOUT);
  });
});
