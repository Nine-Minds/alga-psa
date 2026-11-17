// alga-2026-0002932: moves the citations PR #4018 stored on opportunity_evidence.ref_type / ref_id
// of user_declared rows (active and corrected) into opportunity_evidence_citations, at position 0,
// then clears the refs on those rows. System rows keep their ref: it is their de-dupe key.
//
// Idempotent. The INSERT selects only rows whose ref is still set and skips pairs already
// present; the UPDATE only touches rows whose ref is still set. Both statements run in one
// transaction. Every join carries the tenant column (Citus co-located INSERT ... SELECT).
// No now() anywhere: the citation inherits the declaration's recorded_at as its created_at.

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('opportunity_evidence_citations'))) return;

  // migration-lint: allow 5 - one-shot copy bounded to user_declared rows carrying a #4018 interaction/document ref (live since 2026-11-13, very few rows); idempotent via ON CONFLICT, so no loop+LIMIT batching
  await knex.raw(`
    INSERT INTO opportunity_evidence_citations (tenant, evidence_id, ref_type, ref_id, position, created_at)
    SELECT oe.tenant, oe.evidence_id, oe.ref_type, oe.ref_id, 0, oe.recorded_at
      FROM opportunity_evidence oe
     WHERE oe.source = 'user_declared'
       AND oe.ref_type IN ('interaction', 'document')
       AND oe.ref_id IS NOT NULL
    ON CONFLICT (tenant, evidence_id, ref_type, ref_id) DO NOTHING
  `);

  // migration-lint: allow 5 - UPDATE limited to user_declared rows still carrying an interaction/document ref, which the INSERT above has copied; no data is lost
  await knex.raw(`
    UPDATE opportunity_evidence oe
       SET ref_type = NULL, ref_id = NULL
     WHERE oe.source = 'user_declared'
       AND oe.ref_type IN ('interaction', 'document')
       AND EXISTS (
         SELECT 1 FROM opportunity_evidence_citations c
          WHERE c.tenant = oe.tenant
            AND c.evidence_id = oe.evidence_id
            AND c.ref_type = oe.ref_type
            AND c.ref_id = oe.ref_id
       )
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('opportunity_evidence_citations'))) return;
  // Restore the single #4018 citation (the first one) onto the declaration row.
  await knex.raw(`
    UPDATE opportunity_evidence oe
       SET ref_type = c.ref_type, ref_id = c.ref_id
      FROM opportunity_evidence_citations c
     WHERE c.tenant = oe.tenant
       AND c.evidence_id = oe.evidence_id
       AND c.position = 0
       AND oe.source = 'user_declared'
       AND oe.ref_type IS NULL
  `);
};
