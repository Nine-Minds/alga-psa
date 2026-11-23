/**
 * T238 — F139 of `ee/plans/2026-11-21-itil-remediation` (`docs`).
 *
 * `scripts/reports/priority-board-mismatch.sql` is the read-only report an operator runs per
 * environment. Its priority sections compare families (R3); its category sections used to do the
 * same, which after this plan says nothing — a category belongs to a *board* (R2), so they now
 * compare the category's board with the board the row points at.
 *
 * The whole script is run as one simple query, the way `psql -f` runs it, so `BEGIN READ ONLY`
 * and `ROLLBACK` really do bracket it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  cleanupItilSecondBoardFixture,
  createItilSecondBoardFixture,
  type ItilSecondBoardFixture,
} from './fixtures/itilSecondBoardFixture';

const HOOK_TIMEOUT = 180_000;
const REPORT = path.resolve(__dirname, '../../../../scripts/reports/priority-board-mismatch.sql');

let db: Knex;
let fixture: ItilSecondBoardFixture;

function tt(table: string) {
  return tenantDb(db, fixture.tenantId).table(table);
}

interface ReportRow {
  source: string;
  tenant: string;
  mismatched: number;
  mismatched_active: number;
  boardless?: number;
}

/** Run the script exactly as `psql -f` does, and keep this tenant's rows. */
async function runReport(): Promise<ReportRow[]> {
  const sql = fs.readFileSync(REPORT, 'utf8');
  const connection = await (db.client as any).acquireConnection();
  try {
    const results = await connection.query(sql);
    const sets = Array.isArray(results) ? results : [results];
    return sets
      .flatMap((set: any) => set?.rows ?? [])
      .filter((row: any) => row.tenant === fixture.tenantId)
      .map((row: any) => ({
        source: row.source,
        tenant: row.tenant,
        mismatched: Number(row.mismatched),
        mismatched_active: Number(row.mismatched_active),
        boardless: row.boardless === undefined ? undefined : Number(row.boardless),
      }));
  } finally {
    await (db.client as any).releaseConnection(connection);
  }
}

async function insertTicket(values: {
  boardId: string;
  statusId: string;
  priorityId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
}): Promise<string> {
  const ticketId = uuidv4();
  await tt('tickets').insert({
    tenant: fixture.tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${ticketId.slice(0, 8)}`,
    title: 'Report fixture ticket',
    board_id: values.boardId,
    status_id: values.statusId,
    priority_id: values.priorityId,
    client_id: fixture.clientId,
    category_id: values.categoryId ?? null,
    subcategory_id: values.subcategoryId ?? null,
    entered_by: fixture.userId,
    entered_at: new Date().toISOString(),
  });
  return ticketId;
}

/** A standard category both ITIL boards own a copy of, and each board's copy of it. */
function sharedStandardCopies(): { standardId: string; onOne: string; onTwo: string } {
  const onBoardOne = fixture.itilCategoryIdsByBoard[fixture.boards.itilOne];
  const onBoardTwo = fixture.itilCategoryIdsByBoard[fixture.boards.itilTwo];
  const standardId = Object.keys(onBoardOne).find((id) => onBoardTwo[id]);
  if (!standardId) throw new Error('fixture has no standard category on both ITIL boards');
  return { standardId, onOne: onBoardOne[standardId], onTwo: onBoardTwo[standardId] };
}

describe('priority and category board mismatch report (integration)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    fixture = await createItilSecondBoardFixture(db);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await tt('tickets').del();
  });

  afterAll(async () => {
    if (fixture) await cleanupItilSecondBoardFixture(db, fixture.tenantId);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T238: a tenant with two clean ITIL boards returns no rows', async () => {
    const copies = sharedStandardCopies();

    // Each ticket on the board that owns its category, with a priority of that board's family.
    await insertTicket({
      boardId: fixture.boards.itilOne,
      statusId: fixture.statuses.itilOne,
      priorityId: fixture.itilPriorityIds[3],
      categoryId: copies.onOne,
    });
    await insertTicket({
      boardId: fixture.boards.itilTwo,
      statusId: fixture.statuses.itilTwo,
      priorityId: fixture.itilPriorityIds[2],
      categoryId: copies.onTwo,
    });
    await insertTicket({
      boardId: fixture.boards.own,
      statusId: fixture.statuses.own,
      priorityId: fixture.ownPriorityIds[0],
      categoryId: fixture.ownCategory.parentId,
      subcategoryId: fixture.ownCategory.childId,
    });

    expect(await runReport()).toEqual([]);
  }, HOOK_TIMEOUT);

  it('T238: a ticket holding the other ITIL board’s copy is reported, by board not by family', async () => {
    const copies = sharedStandardCopies();

    // The shape the category migration exists to remove: a ticket on the second ITIL board still
    // pointing at the first board's copy of the same standard category. Both rows are ITIL, so the
    // old family comparison saw nothing wrong with it.
    await insertTicket({
      boardId: fixture.boards.itilTwo,
      statusId: fixture.statuses.itilTwo,
      priorityId: fixture.itilPriorityIds[3],
      categoryId: copies.onOne,
    });

    const rows = await runReport();
    expect(rows).toEqual([
      {
        source: 'tickets (open): category board',
        tenant: fixture.tenantId,
        mismatched: 1,
        mismatched_active: 1,
        boardless: 0,
      },
    ]);
  }, HOOK_TIMEOUT);

  it('T238: a boardless category is reported and counted apart', async () => {
    const strayId = uuidv4();
    await tt('categories').insert({
      tenant: fixture.tenantId,
      category_id: strayId,
      category_name: 'Left behind by a deleted board',
      board_id: null,
      created_by: fixture.userId,
    });

    try {
      await insertTicket({
        boardId: fixture.boards.itilOne,
        statusId: fixture.statuses.itilOne,
        priorityId: fixture.itilPriorityIds[3],
        categoryId: strayId,
      });

      const rows = await runReport();
      expect(rows).toEqual([
        {
          source: 'tickets (open): category board',
          tenant: fixture.tenantId,
          mismatched: 1,
          mismatched_active: 1,
          boardless: 1,
        },
      ]);
    } finally {
      await tt('tickets').del();
      await tt('categories').where({ category_id: strayId }).del();
    }
  }, HOOK_TIMEOUT);

  it('T238: a priority of the wrong family is still reported', async () => {
    // The sections the report already had keep working: an own-family priority on an ITIL board.
    await insertTicket({
      boardId: fixture.boards.itilOne,
      statusId: fixture.statuses.itilOne,
      priorityId: fixture.ownPriorityIds[0],
      categoryId: fixture.itilCategoryIdsByBoard[fixture.boards.itilOne][sharedStandardCopies().standardId],
    });

    const rows = await runReport();
    expect(rows.map((row) => row.source)).toEqual(['tickets (open)']);
    expect(rows[0].mismatched).toBe(1);
  }, HOOK_TIMEOUT);

  it('T238: the report writes nothing', async () => {
    await insertTicket({
      boardId: fixture.boards.itilTwo,
      statusId: fixture.statuses.itilTwo,
      priorityId: fixture.itilPriorityIds[3],
      categoryId: sharedStandardCopies().onOne,
    });

    const before = {
      tickets: await tt('tickets').count({ count: '*' }).first(),
      categories: await tt('categories').count({ count: '*' }).first(),
      boards: await tt('boards').count({ count: '*' }).first(),
    };

    const sql = fs.readFileSync(REPORT, 'utf8');
    expect(sql).toContain('BEGIN READ ONLY;');
    expect(sql.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    await runReport();

    expect({
      tickets: await tt('tickets').count({ count: '*' }).first(),
      categories: await tt('categories').count({ count: '*' }).first(),
      boards: await tt('boards').count({ count: '*' }).first(),
    }).toEqual(before);
  }, HOOK_TIMEOUT);
});
