'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Corrects the form_id for the QBO mapping error task definition
  const updatedCount = await knex('system_workflow_task_definitions')
    .where({ form_id: 'qbo-item-mapping-missing-form' }) // Target the known incorrect form_id
    // To be more specific, you could add: .andWhere({ task_type: 'qbo_mapping_error' })
    // if 'qbo_mapping_error' is the guaranteed task_type for this incorrect form_id.
    .update({
      form_id: 'qbo-mapping-error-form'
    });
  console.log(`Updated ${updatedCount} system task definition(s) to correct form_id 'qbo-mapping-error-form'.`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Reverts the form_id for the QBO mapping error task definition
  const revertedCount = await knex('system_workflow_task_definitions')
    .where({ form_id: 'qbo-mapping-error-form' }) // Target the corrected form_id
    // To be more specific, you could add: .andWhere({ task_type: 'qbo_mapping_error' })
    .update({
      form_id: 'qbo-item-mapping-missing-form' // Revert to the original incorrect value
    });
  console.log(`Reverted ${revertedCount} system task definition(s) back to form_id 'qbo-item-mapping-missing-form'.`);
};
