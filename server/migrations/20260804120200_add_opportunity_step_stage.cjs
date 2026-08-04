'use strict';

/**
 * Which part of the sales process a step belongs to. The timeline draws one
 * segment per stage, so a step needs to say where it sits without borrowing
 * `checkpoint` — that column means "completing this attests the checkpoint",
 * which is a promise a mid-stage step must not make.
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('opportunity_steps', (table) => {
    table.text('stage').nullable();
  });

  await knex.raw(`
    ALTER TABLE opportunity_steps
    ADD CONSTRAINT opportunity_steps_stage_check
    CHECK (stage IS NULL OR stage IN ('identified', 'qualified', 'assessment', 'proposed', 'verbal'))
  `);

  // Steps that already attest a checkpoint plainly belong to that stage.
  await knex.raw(`
    UPDATE opportunity_steps
    SET stage = checkpoint
    WHERE checkpoint IS NOT NULL AND checkpoint <> 'won'
  `);
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE opportunity_steps DROP CONSTRAINT IF EXISTS opportunity_steps_stage_check');
  await knex.schema.alterTable('opportunity_steps', (table) => {
    table.dropColumn('stage');
  });
};
