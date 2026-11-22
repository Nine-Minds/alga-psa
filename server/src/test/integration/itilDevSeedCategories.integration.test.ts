/**
 * T061 — F032 of `ee/plans/2026-11-21-itil-remediation` (`category-schema`).
 *
 * The dev seeds used to stamp the ITIL category set onto whichever board came first, because
 * `80_itil_categories.cjs` ran before the seed that creates the ITIL board. The set now belongs to
 * the ITIL board: this checks the bootstrapped development database, seeds included.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

describe('dev seed ITIL categories (integration)', () => {
  let db: Knex;

  beforeAll(async () => {
    // Reuse the bootstrapped suite database (migrations + dev seeds); never recreate it here.
    db = await createTestDbConnection({ recreate: false });
  }, 300_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('T061: the seeded set sits on the ITIL board and no other board has one', async () => {
    const standardCount = Number(
      (await db('standard_categories').where({ is_itil_standard: true }).count('* as count').first())?.count ?? 0
    );
    expect(standardCount).toBeGreaterThan(0);

    const itilBoards = await db('boards').where({ category_type: 'itil' }).select('tenant', 'board_id', 'board_name');
    expect(itilBoards.length).toBeGreaterThan(0);

    for (const board of itilBoards) {
      const rows = await db('categories')
        .where({ tenant: board.tenant, board_id: board.board_id })
        .whereNotNull('standard_category_id');
      expect(rows.length, `board ${board.board_name} owns the standard set`).toBe(standardCount);
      expect(rows.every((row) => row.is_from_itil_standard === true)).toBe(true);
    }

    // Nothing outside an ITIL board claims to be a standard row.
    const itilBoardIds = new Set(itilBoards.map((board) => `${board.tenant}|${board.board_id}`));
    const flagged = await db('categories')
      .where((builder) => {
        builder.where({ is_from_itil_standard: true }).orWhereNotNull('standard_category_id');
      })
      .select('tenant', 'board_id', 'category_name');
    const strays = flagged.filter((row) => !itilBoardIds.has(`${row.tenant}|${row.board_id}`));
    expect(strays.map((row) => row.category_name)).toEqual([]);
  });
});
