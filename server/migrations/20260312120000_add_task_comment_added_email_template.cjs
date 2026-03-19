/**
 * Add email notification template and subtype for task comment added events.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
  const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { getTemplate } = require('./utils/templates/email/projects/taskCommentAdded.cjs');

  // Ensure the subtype exists
  await upsertEmailCategoriesAndSubtypes(knex);

  // Insert the email template
  await upsertEmailTemplate(knex, getTemplate());
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const { deleteEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

  await deleteEmailTemplate(knex, 'task-comment-added');

  // Remove the subtype
  await knex('notification_subtypes')
    .where({ name: 'Task Comment Added' })
    .del();
};
