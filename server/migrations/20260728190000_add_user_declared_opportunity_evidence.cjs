exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE opportunity_evidence
    DROP CONSTRAINT opportunity_evidence_source_check
  `);
  await knex.raw(`
    ALTER TABLE opportunity_evidence
    ADD CONSTRAINT opportunity_evidence_source_check
    CHECK (source IN ('system', 'declared', 'user_declared'))
  `);
};

exports.down = async function down(knex) {
  await knex('opportunity_evidence')
    .where({ source: 'user_declared' })
    .update({ source: 'declared' });
  await knex.raw(`
    ALTER TABLE opportunity_evidence
    DROP CONSTRAINT opportunity_evidence_source_check
  `);
  await knex.raw(`
    ALTER TABLE opportunity_evidence
    ADD CONSTRAINT opportunity_evidence_source_check
    CHECK (source IN ('system', 'declared'))
  `);
};
