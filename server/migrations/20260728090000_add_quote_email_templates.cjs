/**
 * Seed the Quotes notification category, its subtypes, and the
 * quote-email / quote-reminder-email templates so the quote send, resend, and
 * reminder emails are customizable under
 * Notification Settings > Email Templates.
 */

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: quoteEmail } = require('./utils/templates/email/quotes/quoteEmail.cjs');
const { getTemplate: quoteReminder } = require('./utils/templates/email/quotes/quoteReminder.cjs');

exports.up = async function(knex) {
  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, quoteEmail());
  await upsertEmailTemplate(knex, quoteReminder());
};

exports.down = async function(knex) {
  await knex('system_email_templates')
    .whereIn('name', ['quote-email', 'quote-reminder-email'])
    .del();

  await knex('notification_subtypes')
    .whereIn('name', ['Quote Email', 'Quote Reminder'])
    .del();

  await knex('notification_categories')
    .where({ name: 'Quotes' })
    .whereNotExists(
      knex('notification_subtypes')
        .select(knex.raw('1'))
        .whereRaw('notification_subtypes.category_id = notification_categories.id')
    )
    .del();
};
