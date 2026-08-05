'use strict';

/**
 * A planned opportunity step with a time on it belongs in the assignee's
 * calendar like any other piece of work.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE schedule_entries
    DROP CONSTRAINT IF EXISTS schedule_entries_work_item_type_check
  `);
  await knex.raw(`
    ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_work_item_type_check
    CHECK (work_item_type IN ('project_task', 'ticket', 'interaction', 'ad_hoc', 'appointment_request', 'opportunity_step'))
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DELETE FROM schedule_entries WHERE work_item_type = 'opportunity_step'
  `);
  await knex.raw(`
    ALTER TABLE schedule_entries
    DROP CONSTRAINT IF EXISTS schedule_entries_work_item_type_check
  `);
  await knex.raw(`
    ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_work_item_type_check
    CHECK (work_item_type IN ('project_task', 'ticket', 'interaction', 'ad_hoc', 'appointment_request'))
  `);
};
