const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate, TEMPLATE_NAME, SUBTYPE_NAME } = require('./utils/templates/email/surveys/surveyTicketClosed.cjs');

exports.up = async function up(knex) {
  // Ensure the Surveys category and survey-ticket-closed subtype exist
  await upsertEmailCategoriesAndSubtypes(knex);

  // Upsert the survey email template (all languages)
  await upsertEmailTemplate(knex, getTemplate());
};

exports.down = async function down(knex) {
  await knex('system_email_templates').where({ name: TEMPLATE_NAME }).del();

  const surveySubtype = await knex('notification_subtypes').where({ name: SUBTYPE_NAME }).first();
  if (surveySubtype) {
    await knex('notification_subtypes').where({ id: surveySubtype.id }).del();
  }

  const surveysCategory = await knex('notification_categories').where({ name: 'Surveys' }).first();
  if (surveysCategory) {
    const remainingSubtypes = await knex('notification_subtypes')
      .where({ category_id: surveysCategory.id })
      .count('id as count')
      .first();

    if (!remainingSubtypes || Number(remainingSubtypes.count) === 0) {
      await knex('notification_categories').where({ id: surveysCategory.id }).del();
    }
  }
};
