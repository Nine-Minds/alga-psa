/**
 * Seed the Estimates notification category, its subtypes, and the
 * estimate-email / estimate-reminder-email templates so the estimate send,
 * resend, and reminder emails are customizable under
 * Notification Settings > Email Templates.
 *
 * Development databases that ran the superseded quote migration are renamed in
 * place rather than re-seeded, so tenant customizations and notification
 * preferences pointing at the old rows survive.
 */

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: estimateEmail } = require('./utils/templates/email/estimates/estimateEmail.cjs');
const { getTemplate: estimateReminder } = require('./utils/templates/email/estimates/estimateReminder.cjs');

const SUBTYPE_RENAMES = [
  ['Quote Email', 'Estimate Email'],
  ['Quote Reminder', 'Estimate Reminder'],
];

const TEMPLATE_RENAMES = [
  ['quote-email', 'estimate-email'],
  ['quote-reminder-email', 'estimate-reminder-email'],
];

exports.up = async function(knex) {
  await knex('notification_categories').where({ name: 'Quotes' }).update({ name: 'Estimates' });

  for (const [from, to] of SUBTYPE_RENAMES) {
    await knex('notification_subtypes').where({ name: from }).update({ name: to });
  }

  for (const [from, to] of TEMPLATE_RENAMES) {
    await knex('system_email_templates').where({ name: from }).update({ name: to });
    await knex('tenant_email_templates').where({ name: from }).update({ name: to });
  }

  // Customizations carried over from the quote templates still reference
  // {{quote.*}}; the render context now supplies {{estimate.*}}.
  await knex('tenant_email_templates')
    .whereIn('name', ['estimate-email', 'estimate-reminder-email'])
    .update({
      subject: knex.raw("replace(subject, '{{quote.', '{{estimate.')"),
      html_content: knex.raw("replace(html_content, '{{quote.', '{{estimate.')"),
      text_content: knex.raw("replace(text_content, '{{quote.', '{{estimate.')"),
    });

  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, estimateEmail());
  await upsertEmailTemplate(knex, estimateReminder());
};

exports.down = async function(knex) {
  await knex('system_email_templates')
    .whereIn('name', ['estimate-email', 'estimate-reminder-email'])
    .del();

  await knex('notification_subtypes')
    .whereIn('name', ['Estimate Email', 'Estimate Reminder'])
    .del();

  await knex('notification_categories')
    .where({ name: 'Estimates' })
    .whereNotExists(
      knex('notification_subtypes')
        .select(knex.raw('1'))
        .whereRaw('notification_subtypes.category_id = notification_categories.id')
    )
    .del();
};
