
/**
 * Adds the stock email template for @-mentions:
 * - category/subtype: System / user-mentioned
 * - template: user-mentioned
 *
 * This is one email template across task comments, ticket comments, and
 * documents. The delivery context selects the entity type and name.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
  const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { getTemplate } = require('./utils/templates/email/system/userMentioned.cjs');

  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, getTemplate());
};

exports.down = async function(knex) {
  const { deleteEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

  await deleteEmailTemplate(knex, 'user-mentioned');

  const category = await knex('notification_categories').where({ name: 'System' }).first();
  if (category) {
    await knex('notification_subtypes')
      .where({ category_id: category.id, name: 'user-mentioned' })
      .delete();

    const remainingSubtype = await knex('notification_subtypes')
      .where({ category_id: category.id })
      .first('id');
    if (!remainingSubtype) {
      await knex('notification_categories').where({ id: category.id }).delete();
    }
  }
};
