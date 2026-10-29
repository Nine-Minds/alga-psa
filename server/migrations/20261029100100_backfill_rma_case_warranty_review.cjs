'use strict';

/**
 * Step 2 of 3 for warranty review on rma_cases (alga-2026-0002683, card C5); step 1 is
 * 20261029100000_add_warranty_review_to_rma_cases, step 3 is 20261029100200_validate_rma_case_constraints.
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

  // One RMA counter row per tenant that lacks one, seeded at the highest number in use.
  await drain(knex, `
    INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
    SELECT t.tenant, 'RMA',
           COALESCE((SELECT MAX(NULLIF(regexp_replace(r.rma_number, '\\D', '', 'g'), '')::bigint)
                     FROM rma_cases r WHERE r.tenant = t.tenant), 0),
           1, 'RMA-', 5
    FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM next_number n WHERE n.tenant = t.tenant AND n.entity_type = 'RMA')
    ORDER BY t.tenant
    LIMIT ${BATCH}
    ON CONFLICT (tenant, entity_type) DO NOTHING
  `);
  // A counter that already existed must still clear the backfilled maximum.
  await drain(knex, `
    UPDATE next_number n SET last_number = m.max_n
    FROM (
      SELECT n2.tenant, mx.max_n
      FROM next_number n2
      JOIN LATERAL (
        SELECT MAX(NULLIF(regexp_replace(r.rma_number, '\\D', '', 'g'), '')::bigint) AS max_n
        FROM rma_cases r WHERE r.tenant = n2.tenant
      ) mx ON true
      WHERE n2.entity_type = 'RMA' AND mx.max_n > n2.last_number
      ORDER BY n2.tenant
      LIMIT ${BATCH}
    ) m
    WHERE n.tenant = m.tenant AND n.entity_type = 'RMA'
  `);

  // Every row is numbered now. Added NOT VALID (validated, then promoted to NOT NULL, by step 3).
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_rma_number_present_check');
  await knex.raw('ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_rma_number_present_check CHECK (rma_number IS NOT NULL) NOT VALID');
};

exports.down = async function down() {
  // The backfilled values are data, not schema; step 1's down drops the columns and the RMA counter.
};
