'use strict';

/**
 * Step 2 of 3 for warranty review on rma_cases (alga-2026-0002683, card C5); step 1 is
 * 20261029130000_add_warranty_review_to_rma_cases, step 3 is 20261029130200_validate_rma_case_constraints.
 *
 * Batched backfill (each statement touches at most BATCH rows and the loop runs until nothing is left):
 *  - closed cases get closed_reason = 'resolved'
 *  - rma_number per tenant (RMA-00001 ...), continuing above any number already in use; rows are taken
 *    tenant-first in opened order so a tenant's numbering is stable across batches
 *  - next_number for entity type RMA starts at the backfilled maximum, and never moves backwards, so a new
 *    claim never collides
 *
 * Idempotent: every statement only selects rows that still need the change.
 */

const BATCH = 500;

async function drain(knex, sql, bindings) {
  let touched;
  do {
    const result = await knex.raw(sql, bindings);
    touched = result.rowCount ?? 0;
  } while (touched > 0);
}

exports.up = async function up(knex) {
  await drain(knex, `
    UPDATE rma_cases r SET closed_reason = 'resolved'
    WHERE (r.tenant, r.rma_id) IN (
      SELECT tenant, rma_id FROM rma_cases
      WHERE closed_reason IS NULL AND (closed_at IS NOT NULL OR status = 'closed')
      ORDER BY tenant, rma_id
      LIMIT ${BATCH}
    )
  `);

  await drain(knex, `
    WITH picked AS (
      SELECT tenant, rma_id, opened_at, created_at
      FROM rma_cases
      WHERE rma_number IS NULL
      ORDER BY tenant, opened_at NULLS FIRST, created_at NULLS FIRST, rma_id
      LIMIT ${BATCH}
    ), numbered AS (
      SELECT tenant, rma_id,
             ROW_NUMBER() OVER (PARTITION BY tenant ORDER BY opened_at NULLS FIRST, created_at NULLS FIRST, rma_id) AS n
      FROM picked
    ), base AS (
      SELECT p.tenant, COALESCE(MAX(NULLIF(regexp_replace(r.rma_number, '\\D', '', 'g'), '')::bigint), 0) AS max_n
      FROM (SELECT DISTINCT tenant FROM picked) p
      LEFT JOIN rma_cases r ON r.tenant = p.tenant AND r.rma_number IS NOT NULL
      GROUP BY p.tenant
    )
    UPDATE rma_cases r
    SET rma_number = 'RMA-' || LPAD((b.max_n + numbered.n)::text, 5, '0')
    FROM numbered
    JOIN base b ON b.tenant = numbered.tenant
    WHERE r.tenant = numbered.tenant AND r.rma_id = numbered.rma_id
  `);

  // RMA counter per tenant, seeded at (never below) the highest number in use. Citus rejects any statement that
  // joins the reference table `tenants` with distributed tables (next_number, rma_cases), so tenant ids are read
  // on their own, keyset-paged, and each tenant is then handled by single-tenant statements that touch only
  // distributed tables filtered on the literal tenant (router-executable, co-located on `tenant`).
  const maxRmaNumber = `SELECT MAX(NULLIF(regexp_replace(rma_number, '\\D', '', 'g'), '')::bigint) FROM rma_cases WHERE tenant = ?`;
  let after = null;
  for (;;) {
    const page = after === null
      ? await knex.raw(`SELECT tenant FROM tenants ORDER BY tenant LIMIT ${BATCH}`)
      : await knex.raw(`SELECT tenant FROM tenants WHERE tenant > ? ORDER BY tenant LIMIT ${BATCH}`, [after]);
    const tenantIds = page.rows.map((row) => row.tenant);
    if (tenantIds.length === 0) break;
    for (const tenant of tenantIds) {
      await knex.raw(
        `INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
         SELECT ?::uuid, 'RMA', COALESCE((${maxRmaNumber}), 0), 1, 'RMA-', 5
         ON CONFLICT (tenant, entity_type) DO NOTHING`,
        [tenant, tenant]
      );
      // A counter that already existed must still clear the backfilled maximum.
      await knex.raw(
        `UPDATE next_number SET last_number = m.max_n
         FROM (${maxRmaNumber}) AS m(max_n)
         WHERE next_number.tenant = ? AND next_number.entity_type = 'RMA' AND m.max_n > next_number.last_number`,
        [tenant, tenant]
      );
    }
    after = tenantIds[tenantIds.length - 1];
  }

  // Every row is numbered now. Added NOT VALID (validated, then promoted to NOT NULL, by step 3).
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_rma_number_present_check');
  await knex.raw('ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_rma_number_present_check CHECK (rma_number IS NOT NULL) NOT VALID');
};

exports.down = async function down() {
  // The backfilled values are data, not schema; step 1's down drops the columns and the RMA counter.
};
