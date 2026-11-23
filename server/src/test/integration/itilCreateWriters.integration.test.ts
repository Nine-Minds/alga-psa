/**
 * T134–T154 — F069–F081 of `ee/plans/2026-11-21-itil-remediation` (`writers-create`).
 *
 * Every create path funnels through `TicketModel.createTicket`, which now applies the board field
 * rules with the policy its caller passed (R6): `refuse` raises a field error naming the field,
 * `fallback` repairs the values so an automated path never loses the ticket. The two writers that
 * insert their ticket row directly — RMM alerts and Huntress incidents — are driven end to end
 * here, because for them there is no funnel to stand behind.
 *
 * Which caller passes which policy is pinned by
 * `server/src/test/unit/itilCreateWritersContract.test.ts`; this file is the behaviour, against
 * the two-ITIL-board fixture so a value that works on the first board is also tried on the second.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  preCheckDeletion: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

import { tenantDb } from '@alga-psa/db';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { silentTicketCreation } from '@alga-psa/shared/lib/tickets/ticketLifecycleEvents';
import {
  defaultPriorityForBoard,
  findBoardFieldProblems,
  isBoardFieldRuleError,
  prepareTicketCreateFields,
  resolveTicketPriorityFields,
} from '@alga-psa/shared/lib/tickets/boardFieldRules';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  cleanupItilSecondBoardFixture,
  createItilSecondBoardFixture,
  type ItilSecondBoardFixture,
} from './fixtures/itilSecondBoardFixture';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
let fixture: ItilSecondBoardFixture;

function tt(table: string) {
  return tenantDb(db, fixture.tenantId).table(table);
}

/** The standard category every ITIL board owns a copy of, by `standard_categories.id`. */
function standardCategoryOnBoard(boardId: string, standardId: string): string {
  return fixture.itilCategoryIdsByBoard[boardId][standardId];
}

function firstStandardId(): string {
  return Object.keys(fixture.itilCategoryIdsByBoard[fixture.boards.itilOne])[0];
}

interface CreateOverrides {
  boardId?: string;
  statusId?: string;
  priorityId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  policy?: 'refuse' | 'fallback';
}

/** A create through the funnel every path reaches, with the policy the path would pass. */
async function createThroughModel(overrides: CreateOverrides = {}): Promise<{ ticket_id: string }> {
  const boardId = overrides.boardId ?? fixture.boards.itilTwo;
  const statusKey = (Object.keys(fixture.boards) as Array<keyof ItilSecondBoardFixture['boards']>).find(
    (key) => fixture.boards[key] === boardId
  )!;
  return db.transaction((trx) =>
    TicketModel.createTicket(
      {
        title: 'Create writer probe',
        board_id: boardId,
        client_id: fixture.clientId,
        status_id: overrides.statusId ?? fixture.statuses[statusKey],
        priority_id: overrides.priorityId ?? undefined,
        category_id: overrides.categoryId ?? undefined,
        subcategory_id: overrides.subcategoryId ?? undefined,
        entered_by: fixture.userId,
      } as any,
      fixture.tenantId,
      trx,
      { skipLocationValidation: true, boardFieldPolicy: overrides.policy ?? 'refuse' },
      silentTicketCreation('writers-create behaviour test'),
      undefined,
      fixture.userId
    )
  );
}

async function storedTicket(ticketId: string) {
  return tt('tickets')
    .where({ ticket_id: ticketId })
    .first('board_id', 'priority_id', 'category_id', 'subcategory_id', 'itil_impact', 'itil_urgency');
}

describe('ITIL create writers (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    if (!fixture) return;
    // The raw-insert writers leave a note and a watcher behind, and both reference the ticket.
    await tt('comments').del();
    await tt('comment_threads').del();
    await tt('ticket_watchers').del();
    await tt('asset_associations').del();
    await tt('next_number').del();
    await cleanupItilSecondBoardFixture(db, fixture.tenantId);
    fixture = undefined as unknown as ItilSecondBoardFixture;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  async function withFixture(): Promise<void> {
    fixture = await createItilSecondBoardFixture(db);
    dbRef.knex = db;
    dbRef.tenant = fixture.tenantId;
    userRef.user = { user_id: fixture.userId, user_type: 'internal', tenant: fixture.tenantId };
  }

  describe('the field policy inside TicketModel.createTicket (F069)', () => {
    it('T134: refuse rejects a wrong-family priority and a category from another board', async () => {
      await withFixture();

      const priorityRefusal = await createThroughModel({
        priorityId: fixture.ownPriorityIds[0],
      }).catch((error) => error);
      expect(isBoardFieldRuleError(priorityRefusal)).toBe(true);
      expect(priorityRefusal.field).toBe('priority_id');
      expect(priorityRefusal.message).toContain('ITIL Two');

      // The tenant's own category belongs to `Own Work`, has no standard link, and so cannot be
      // translated: it is refused on the second ITIL board.
      const categoryRefusal = await createThroughModel({
        priorityId: fixture.itilPriorityIds[3],
        categoryId: fixture.ownCategory.parentId,
      }).catch((error) => error);
      expect(isBoardFieldRuleError(categoryRefusal)).toBe(true);
      expect(categoryRefusal.field).toBe('category_id');

      expect(await tt('tickets').count('* as n').first()).toMatchObject({ n: '0' });
    }, HOOK_TIMEOUT);

    it('T135: fallback creates the ticket with the board default priority and without the foreign category', async () => {
      await withFixture();

      const created = await createThroughModel({
        priorityId: fixture.ownPriorityIds[0],
        categoryId: fixture.ownCategory.parentId,
        policy: 'fallback',
      });

      expect(await storedTicket(created.ticket_id)).toMatchObject({
        board_id: fixture.boards.itilTwo,
        // R7: the level-3 ITIL priority, because the board has no default of its own.
        priority_id: fixture.itilPriorityIds[3],
        category_id: null,
        subcategory_id: null,
      });
    }, HOOK_TIMEOUT);

    it('T154: a non-standard category of another board is refused on a refuse path and dropped on a fall-back path', async () => {
      await withFixture();

      // `Board-only extra` is a category of ITIL Two with no standard link: on ITIL One it is
      // another board's category and nothing can translate it.
      const refusal = await createThroughModel({
        boardId: fixture.boards.itilOne,
        priorityId: fixture.itilPriorityIds[2],
        categoryId: fixture.itilTwoOwnCategoryId,
      }).catch((error) => error);
      expect(isBoardFieldRuleError(refusal)).toBe(true);
      expect(refusal.field).toBe('category_id');
      expect(refusal.message).toContain('Board-only extra');

      const created = await createThroughModel({
        boardId: fixture.boards.itilOne,
        priorityId: fixture.itilPriorityIds[2],
        categoryId: fixture.itilTwoOwnCategoryId,
        policy: 'fallback',
      });
      expect(await storedTicket(created.ticket_id)).toMatchObject({ category_id: null });
    }, HOOK_TIMEOUT);

    it('T152: a create on the second ITIL board naming the first board’s standard category stores the second board’s copy', async () => {
      await withFixture();

      const standardId = firstStandardId();
      const created = await createThroughModel({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[3],
        categoryId: standardCategoryOnBoard(fixture.boards.itilOne, standardId),
      });

      expect(await storedTicket(created.ticket_id)).toMatchObject({
        category_id: standardCategoryOnBoard(fixture.boards.itilTwo, standardId),
      });
    }, HOOK_TIMEOUT);

    it('T153: a fall-back create naming another ITIL board’s standard category stores this board’s copy instead of dropping it', async () => {
      await withFixture();

      const standardId = firstStandardId();
      // The seam the workflow `tickets.create` and the inbound webhook create both pass through.
      const created = await createThroughModel({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[1],
        categoryId: standardCategoryOnBoard(fixture.boards.itilOne, standardId),
        policy: 'fallback',
      });

      expect(await storedTicket(created.ticket_id)).toMatchObject({
        category_id: standardCategoryOnBoard(fixture.boards.itilTwo, standardId),
        priority_id: fixture.itilPriorityIds[1],
      });
    }, HOOK_TIMEOUT);

    it('T137: a client portal create with a wrong-family priority is refused, and the portal reports it as a field error', async () => {
      await withFixture();

      // The portal posts a priority and lets the board come from its own resolution; the funnel
      // refuses the value because the board does not use that family.
      const refusal = await createThroughModel({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[1],
      }).catch((error) => error);
      expect(isBoardFieldRuleError(refusal)).toBe(true);
      expect(refusal.field).toBe('priority_id');
      // The portal turns exactly this error into a returned field error; that branch is pinned by
      // `itilCreateWritersContract.test.ts`, because its action module cannot export a helper.
      expect(await tt('tickets').count('* as n').first()).toMatchObject({ n: '0' });
    }, HOOK_TIMEOUT);

    it('T147: a fall-back create whose category is neither the board’s nor translatable stores no category', async () => {
      await withFixture();

      // The inbound webhook maps a board and a category independently, so the pair can disagree.
      const created = await createThroughModel({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[4],
        categoryId: fixture.ownCategory.childId,
        policy: 'fallback',
      });
      expect(await storedTicket(created.ticket_id)).toMatchObject({
        category_id: null,
        subcategory_id: null,
      });
    }, HOOK_TIMEOUT);

    it('T146: a fall-back create with a wrong-family priority stores the board default', async () => {
      await withFixture();

      // Workflow `tickets.create` (D7) and the data-migration import pass this policy.
      const created = await createThroughModel({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        policy: 'fallback',
      });
      expect(await storedTicket(created.ticket_id)).toMatchObject({
        priority_id: fixture.itilPriorityIds[3],
      });
    }, HOOK_TIMEOUT);

    it('T149: a fall-back create on a board whose own default fits keeps that default', async () => {
      await withFixture();

      // The data-migration import maps a source priority that may belong to the other family; the
      // destination board's configured default answers for it (R7), not the tenant's first row.
      await tt('boards')
        .where({ board_id: fixture.boards.itilTwo })
        .update({ default_priority_id: fixture.itilPriorityIds[2] });

      const created = await createThroughModel({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
        policy: 'fallback',
      });
      expect(await storedTicket(created.ticket_id)).toMatchObject({
        priority_id: fixture.itilPriorityIds[2],
      });
    }, HOOK_TIMEOUT);

    it('T145: a fall-back create keeps a configured priority that does fit the board', async () => {
      await withFixture();

      // The telephony auto-ticket and the renewal ticket both pass a configured priority through
      // this seam: a fitting one is kept untouched, so falling back is not a rewrite.
      const created = await createThroughModel({
        boardId: fixture.boards.own,
        priorityId: fixture.ownPriorityIds[1],
        policy: 'fallback',
      });
      expect(await storedTicket(created.ticket_id)).toMatchObject({
        priority_id: fixture.ownPriorityIds[1],
      });
    }, HOOK_TIMEOUT);

    it('T148: a create with no priority on a fall-back path takes the board default and never a project-task priority', async () => {
      await withFixture();

      // The service request provider configures no priority on many definitions.
      const onOwn = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards.own,
        priorityId: null,
        policy: 'fallback',
      });
      expect(onOwn.priority_id).toBe(fixture.ownPriorityIds[0]);

      const onItil = await resolveTicketPriorityFields(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: null,
        policy: 'fallback',
      });
      expect(onItil.priority_id).toBe(fixture.itilPriorityIds[3]);

      const projectTaskIds = await tt('priorities').where({ item_type: 'project_task' }).pluck('priority_id');
      expect(projectTaskIds.length).toBeGreaterThan(0);
      expect(projectTaskIds).not.toContain(onOwn.priority_id);
      expect(projectTaskIds).not.toContain(onItil.priority_id);
    }, HOOK_TIMEOUT);

    it('T141: the maintenance workflow action’s priority check refuses a wrong-family priority', async () => {
      await withFixture();

      // `assets.create_maintenance_ticket` asks the shared rules before it creates anything, so
      // the action fails with a field error rather than writing a ticket.
      const problems = await findBoardFieldProblems(db, fixture.tenantId, {
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.ownPriorityIds[0],
      });
      expect(problems.map((problem) => problem.field)).toEqual(['priority_id']);
      expect(problems[0].message).toContain('ITIL Two');
    }, HOOK_TIMEOUT);

    it('T140: a board whose stored default priority is of the other family still hands out a fitting one', async () => {
      await withFixture();

      // Teams message actions, Teams guest intake and the manual telephony ticket all take their
      // priority from this rule.
      await tt('boards')
        .where({ board_id: fixture.boards.itilTwo })
        .update({ default_priority_id: fixture.ownPriorityIds[0] });

      await expect(defaultPriorityForBoard(db, fixture.tenantId, fixture.boards.itilTwo)).resolves.toBe(
        fixture.itilPriorityIds[3]
      );

      const created = await createThroughModel({
        boardId: fixture.boards.itilTwo,
        priorityId: await defaultPriorityForBoard(db, fixture.tenantId, fixture.boards.itilTwo),
      });
      expect(await storedTicket(created.ticket_id)).toMatchObject({
        priority_id: fixture.itilPriorityIds[3],
      });
    }, HOOK_TIMEOUT);
  });

  describe('CSV import, per row against the row’s board (F071)', () => {
    async function runImport(rows: Array<Partial<Record<string, unknown>>>) {
      const { importTickets } = await import('../../../../packages/tickets/src/actions/ticketImportActions');
      const processed = rows.map((row, index) => ({
        title: `Imported row ${index + 1}`,
        description: null,
        status_id: null,
        priority_id: null,
        board_id: fixture.boards.own,
        category_id: null,
        subcategory_id: null,
        client_id: fixture.clientId,
        contact_id: null,
        assigned_to: null,
        assigned_team_id: null,
        due_date: null,
        entered_at: null,
        closed_at: null,
        is_closed: false,
        tags: [] as string[],
        rowNumber: index + 1,
        ...row,
      }));
      return (await importTickets(processed as any, [], [], [], [], [], fixture.boards.own)) as any;
    }

    it('T138: rows for an ITIL and a non-ITIL board import the fitting rows and report the others', async () => {
      await withFixture();

      const result = await runImport([
        // Fits: the tenant's own board with its own priority.
        { board_id: fixture.boards.own, priority_id: fixture.ownPriorityIds[1] },
        // Fits: the second ITIL board with an ITIL priority and that board's own standard category.
        {
          board_id: fixture.boards.itilTwo,
          status_id: fixture.statuses.itilTwo,
          priority_id: fixture.itilPriorityIds[2],
          category_id: standardCategoryOnBoard(fixture.boards.itilTwo, firstStandardId()),
        },
        // Does not fit: the tenant's own priority on an ITIL board.
        {
          board_id: fixture.boards.itilTwo,
          status_id: fixture.statuses.itilTwo,
          priority_id: fixture.ownPriorityIds[0],
        },
        // Does not fit: a category of another board that cannot be translated.
        {
          board_id: fixture.boards.itilTwo,
          status_id: fixture.statuses.itilTwo,
          priority_id: fixture.itilPriorityIds[2],
          category_id: fixture.ownCategory.parentId,
        },
      ]);

      expect(result.ticketsCreated).toBe(2);
      expect(result.ticketsSkipped).toBe(2);
      expect(result.errors.join('\n')).toContain('Row 3');
      expect(result.errors.join('\n')).toContain('Row 4');

      const stored = await tt('tickets').select('board_id', 'priority_id', 'category_id');
      expect(stored).toHaveLength(2);
      expect(stored.map((row: any) => row.priority_id).sort()).toEqual(
        [fixture.ownPriorityIds[1], fixture.itilPriorityIds[2]].sort()
      );
    }, HOOK_TIMEOUT);

    it('T139: a row without a priority gets its board’s default priority', async () => {
      await withFixture();

      const result = await runImport([
        { board_id: fixture.boards.own },
        { board_id: fixture.boards.itilTwo, status_id: fixture.statuses.itilTwo },
      ]);

      expect(result.errors).toEqual([]);
      expect(result.ticketsCreated).toBe(2);
      const stored = await tt('tickets').select('board_id', 'priority_id');
      expect(stored.find((row: any) => row.board_id === fixture.boards.own)?.priority_id).toBe(
        fixture.ownPriorityIds[0]
      );
      expect(stored.find((row: any) => row.board_id === fixture.boards.itilTwo)?.priority_id).toBe(
        fixture.itilPriorityIds[3]
      );
    }, HOOK_TIMEOUT);
  });

  describe('the two writers that insert their ticket row directly (F074, F075)', () => {
    it('T142: an RMM alert whose mapped priority is of the wrong family is created with the board default', async () => {
      await withFixture();
      const { createTicketForAlert } = await import('../../../../shared/rmm/alerts/ticketCreator');

      const created = await db.transaction((trx) =>
        createTicketForAlert(trx, {
          event: {
            tenantId: fixture.tenantId,
            integrationId: randomUUID(),
            provider: 'ninjaone',
            kind: 'alert',
            externalAlertId: `alert-${randomUUID()}`,
            severity: 'critical',
            occurredAt: new Date().toISOString(),
            raw: {},
          } as any,
          actions: { boardId: fixture.boards.itilTwo, priorityOverride: fixture.ownPriorityIds[1] } as any,
          clientId: fixture.clientId,
        })
      );

      expect(await storedTicket(created.ticket_id)).toMatchObject({
        board_id: fixture.boards.itilTwo,
        priority_id: fixture.itilPriorityIds[3],
      });
    }, HOOK_TIMEOUT);

    it('T143: the RMM severity lookup never returns a project-task priority', async () => {
      await withFixture();
      const { createTicketForAlert } = await import('../../../../shared/rmm/alerts/ticketCreator');

      // A project-task priority named like the severity candidate for `critical`.
      const taskPriorityId = randomUUID();
      await tt('priorities').insert({
        tenant: fixture.tenantId,
        priority_id: taskPriorityId,
        priority_name: 'Urgent',
        color: '#111111',
        order_number: 0,
        item_type: 'project_task',
        is_from_itil_standard: false,
        created_by: fixture.userId,
      });
      // And a ticket priority of the board's own family with the same name, lower in the order.
      const ticketPriorityId = randomUUID();
      await tt('priorities').insert({
        tenant: fixture.tenantId,
        priority_id: ticketPriorityId,
        priority_name: 'Urgent',
        color: '#111111',
        order_number: 5,
        item_type: 'ticket',
        is_from_itil_standard: false,
        created_by: fixture.userId,
      });

      const created = await db.transaction((trx) =>
        createTicketForAlert(trx, {
          event: {
            tenantId: fixture.tenantId,
            integrationId: randomUUID(),
            provider: 'ninjaone',
            kind: 'alert',
            externalAlertId: `alert-${randomUUID()}`,
            severity: 'critical',
            occurredAt: new Date().toISOString(),
            raw: {},
          } as any,
          actions: { boardId: fixture.boards.own } as any,
          clientId: fixture.clientId,
        })
      );

      const stored = await storedTicket(created.ticket_id);
      expect(stored.priority_id).toBe(ticketPriorityId);
      expect(stored.priority_id).not.toBe(taskPriorityId);
    }, HOOK_TIMEOUT);

    it('T144: a Huntress incident with a wrong-family priority and a foreign category is created with the board default and no category', async () => {
      await withFixture();
      const { createHuntressTicket } = await import(
        '../../../../ee/server/src/lib/integrations/huntress/incidents/ticketCreator'
      );

      const created = await db.transaction((trx) =>
        createHuntressTicket(trx, fixture.tenantId, {
          clientId: fixture.clientId,
          boardId: fixture.boards.itilTwo,
          priorityId: fixture.ownPriorityIds[0],
          categoryId: fixture.ownCategory.parentId,
          title: 'Huntress incident probe',
          body: 'body',
          note: 'internal note',
          sourceReference: `incident-${randomUUID()}`,
        })
      );

      expect(await storedTicket(created.ticket_id)).toMatchObject({
        board_id: fixture.boards.itilTwo,
        priority_id: fixture.itilPriorityIds[3],
        category_id: null,
      });
    }, HOOK_TIMEOUT);

    it('T144: a Huntress incident naming the first ITIL board’s standard category stores the second board’s copy', async () => {
      await withFixture();
      const { createHuntressTicket } = await import(
        '../../../../ee/server/src/lib/integrations/huntress/incidents/ticketCreator'
      );

      const standardId = firstStandardId();
      const created = await db.transaction((trx) =>
        createHuntressTicket(trx, fixture.tenantId, {
          clientId: fixture.clientId,
          boardId: fixture.boards.itilTwo,
          priorityId: fixture.itilPriorityIds[1],
          categoryId: standardCategoryOnBoard(fixture.boards.itilOne, standardId),
          title: 'Huntress incident probe',
          body: 'body',
          note: 'internal note',
          sourceReference: `incident-${randomUUID()}`,
        })
      );

      expect(await storedTicket(created.ticket_id)).toMatchObject({
        category_id: standardCategoryOnBoard(fixture.boards.itilTwo, standardId),
        priority_id: fixture.itilPriorityIds[1],
      });
    }, HOOK_TIMEOUT);
  });

  describe('the REST create paths (F080)', () => {
    it('T150: the REST model-error mapper turns a refused category into a 400 against category_id', async () => {
      await withFixture();

      const refusal = await createThroughModel({
        boardId: fixture.boards.itilTwo,
        priorityId: fixture.itilPriorityIds[3],
        categoryId: fixture.ownCategory.parentId,
      }).catch((error) => error);
      expect(isBoardFieldRuleError(refusal)).toBe(true);

      const { throwTicketModelCreateApiError } = await import('../../lib/api/services/TicketService');
      const mapped = (() => {
        try {
          throwTicketModelCreateApiError(refusal);
        } catch (error) {
          return error as any;
        }
      })();
      expect(mapped.statusCode).toBe(400);
      expect(mapped.details?.[0]).toMatchObject({ path: ['category_id'] });
    }, HOOK_TIMEOUT);
  });

  describe('the rule itself (F081)', () => {
    it('T151: every standard category of the second ITIL board is accepted there, and the first board’s copy is translated to it', async () => {
      await withFixture();

      const byStandardId = fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo];
      const parentOf = new Map<string, string | null>(
        (await tt('categories').whereNotNull('standard_category_id').select('category_id', 'parent_category')).map(
          (row: any) => [row.category_id, row.parent_category]
        )
      );
      let translatedParents = 0;
      let translatedChildren = 0;

      for (const [standardId, categoryId] of Object.entries(byStandardId)) {
        const onBoardOne = standardCategoryOnBoard(fixture.boards.itilOne, standardId);
        const parentOnBoardOne = parentOf.get(onBoardOne) ?? null;
        // A standard child is offered as a subcategory of its parent's copy, which is how the
        // ticket form stores it; a top-level row is offered as the category.
        const prepared = await prepareTicketCreateFields(db, fixture.tenantId, {
          boardId: fixture.boards.itilTwo,
          priorityId: fixture.itilPriorityIds[3],
          categoryId: parentOnBoardOne ?? onBoardOne,
          subcategoryId: parentOnBoardOne ? onBoardOne : null,
          policy: 'refuse',
        });
        expect(prepared.problems, `standard category ${standardId} on the second ITIL board`).toEqual([]);
        if (parentOnBoardOne) {
          expect(prepared.subcategory_id).toBe(categoryId);
          expect(prepared.category_id).toBe(byStandardId[
            Object.keys(byStandardId).find(
              (candidate) => byStandardId[candidate] === (parentOf.get(categoryId) ?? '')
            )!
          ]);
          translatedChildren++;
        } else {
          expect(prepared.category_id).toBe(categoryId);
          translatedParents++;
        }
      }

      expect(translatedParents).toBeGreaterThan(0);
      expect(translatedChildren).toBeGreaterThan(0);
    }, HOOK_TIMEOUT);
  });
});
