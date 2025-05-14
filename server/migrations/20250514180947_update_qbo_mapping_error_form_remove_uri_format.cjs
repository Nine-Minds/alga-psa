'use strict';

const TABLE_NAME = 'system_workflow_form_definitions';
const FORM_NAME = 'qbo-mapping-error-form';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const formDefinition = await knex(TABLE_NAME)
    .where({ name: FORM_NAME })
    .first();

  if (formDefinition && formDefinition.json_schema && formDefinition.json_schema.properties && formDefinition.json_schema.properties.quickbooksSetupLink) {
    const updatedSchema = { ...formDefinition.json_schema };
    delete updatedSchema.properties.quickbooksSetupLink.format;

    await knex(TABLE_NAME)
      .where({ name: FORM_NAME })
      .update({
        json_schema: updatedSchema,
        updated_at: knex.fn.now(),
      });
  } else {
    console.warn(`Form definition for '${FORM_NAME}' not found or schema structure is unexpected. Skipping update.`);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const formDefinition = await knex(TABLE_NAME)
    .where({ name: FORM_NAME })
    .first();

  if (formDefinition && formDefinition.json_schema && formDefinition.json_schema.properties && formDefinition.json_schema.properties.quickbooksSetupLink) {
    const revertedSchema = { ...formDefinition.json_schema };
    revertedSchema.properties.quickbooksSetupLink.format = 'uri';

    await knex(TABLE_NAME)
      .where({ name: FORM_NAME })
      .update({
        json_schema: revertedSchema,
        updated_at: knex.fn.now(),
      });
  } else {
    console.warn(`Form definition for '${FORM_NAME}' not found or schema structure is unexpected. Skipping revert.`);
  }
};
