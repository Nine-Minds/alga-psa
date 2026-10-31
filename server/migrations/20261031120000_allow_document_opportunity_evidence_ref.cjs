/**
 * Lets opportunity evidence cite a document (card 94df4215). Swaps the
 * ref_type CHECK for one that also admits 'document' in a single ALTER; the
 * table is not rewritten.
 */
const CONSTRAINT = 'opportunity_evidence_ref_type_check';

exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE opportunity_evidence
      DROP CONSTRAINT IF EXISTS ${CONSTRAINT},
      ADD CONSTRAINT ${CONSTRAINT}
      CHECK (ref_type IS NULL OR ref_type IN ('quote', 'contract', 'project', 'schedule_entry', 'interaction', 'document'))
  `);
};

exports.down = async function down(knex) {
  // Rows citing a document cannot satisfy the narrower list; drop the citation
  // (the declaration itself stays) before restoring it.
  await knex('opportunity_evidence')
    .where({ ref_type: 'document' })
    .update({ ref_type: null, ref_id: null });
  await knex.raw(`
    ALTER TABLE opportunity_evidence
      DROP CONSTRAINT IF EXISTS ${CONSTRAINT},
      ADD CONSTRAINT ${CONSTRAINT}
      CHECK (ref_type IS NULL OR ref_type IN ('quote', 'contract', 'project', 'schedule_entry', 'interaction'))
  `);
};
