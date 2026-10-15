const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate, TEMPLATE_NAME, SUBTYPE_NAME } = require('./utils/templates/email/surveys/surveyProjectClosed.cjs');
exports.up = async knex => {
  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, getTemplate());
};
exports.down = async knex => {
  await knex('system_email_templates').where({ name: TEMPLATE_NAME }).del();
  await knex('notification_subtypes').where({ name: SUBTYPE_NAME }).del();
};
