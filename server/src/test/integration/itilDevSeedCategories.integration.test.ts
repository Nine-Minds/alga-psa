/**
 * T061 — F032 of `ee/plans/2026-11-21-itil-remediation` (`category-schema`).
 *
 * The dev seeds used to stamp the ITIL category set onto whichever board came first, because
 * `80_itil_categories.cjs` ran before the seed that creates the ITIL board. The set now belongs to
 * the ITIL board, and the file numbering is what guarantees it: `85_itil_priorities.cjs` creates
 * the board, `86_itil_categories.cjs` fills it.
 *
 * The two seeds are run here in the order knex would run them, inside a transaction that is rolled
 * back, so the check does not depend on whether this database happens to have been bootstrapped
 * with dev seeds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const SEEDS_DIR = path.resolve(__dirname, '../../../seeds/dev');
const ROLLBACK = Symbol('rollback');

describe('dev seed ITIL categories (integration)', () => {
  let db: Knex;

  beforeAll(async () => {
    // Reuse the bootstrapped suite database (migrations, seeds or not); never recreate it here.
    db = await createTestDbConnection({ recreate: false });
  }, 300_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('T061: the seeded set sits on the ITIL board and no other board has one', async () => {
    // The order under test is the file order knex reads the directory in.
    const itilSeeds = fs
      .readdirSync(SEEDS_DIR)
      .filter((file) => /itil/.test(file) && file.endsWith('.cjs'))
      .sort();
    expect(itilSeeds).toEqual(['85_itil_priorities.cjs', '86_itil_categories.cjs']);

    let failure: unknown;
    await db
      .transaction(async (trx) => {
        try {
          // The seeds work on the first tenant they find; give them one, with a user, when this
          // database has none.
          let tenantId = (await trx('tenants').select('tenant').first())?.tenant as string | undefined;
          if (!tenantId) {
            tenantId = uuidv4();
            await trx('tenants').insert({
              tenant: tenantId,
              client_name: 'ITIL seed check',
              email: `itil-seed-${tenantId.slice(0, 8)}@example.com`,
              product_code: 'psa',
            });
          }
          const hasUser = await trx('users').where({ tenant: tenantId }).first();
          if (!hasUser) {
            await trx('users').insert({
              tenant: tenantId,
              user_id: uuidv4(),
              username: `itil-seed-${tenantId.slice(0, 8)}`,
              hashed_password: 'not-a-login',
              email: `itil-seed-user-${tenantId.slice(0, 8)}@example.com`,
            });
          }

          for (const file of itilSeeds) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const seedModule = require(path.join(SEEDS_DIR, file));
            await seedModule.seed(trx);
          }

          const standardCount = Number(
            (await trx('standard_categories').where({ is_itil_standard: true }).count('* as count').first())?.count ?? 0
          );
          expect(standardCount).toBeGreaterThan(0);

          const itilBoards = await trx('boards')
            .where({ category_type: 'itil' })
            .select('tenant', 'board_id', 'board_name');
          expect(itilBoards.length).toBeGreaterThan(0);

          for (const board of itilBoards) {
            const rows = await trx('categories')
              .where({ tenant: board.tenant, board_id: board.board_id })
              .whereNotNull('standard_category_id');
            expect(rows.length, `board ${board.board_name} owns the standard set`).toBe(standardCount);
            expect(rows.every((row) => row.is_from_itil_standard === true)).toBe(true);
          }

          // Nothing outside an ITIL board claims to be a standard row.
          const itilBoardIds = new Set(itilBoards.map((board) => `${board.tenant}|${board.board_id}`));
          const flagged = await trx('categories')
            .where((builder) => {
              builder.where({ is_from_itil_standard: true }).orWhereNotNull('standard_category_id');
            })
            .select('tenant', 'board_id', 'category_name');
          const strays = flagged.filter((row) => !itilBoardIds.has(`${row.tenant}|${row.board_id}`));
          expect(strays.map((row) => row.category_name)).toEqual([]);
        } catch (error) {
          failure = error;
        }
        // Leave the database as it was found.
        throw ROLLBACK;
      })
      .catch((error) => {
        if (error !== ROLLBACK) throw error;
      });

    if (failure) throw failure;
  }, 300_000);
});
