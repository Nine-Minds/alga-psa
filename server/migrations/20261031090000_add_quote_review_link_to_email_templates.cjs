/**
 * Add the per-recipient `quoteReviewLink` call to action to the system
 * quote-email and quote-reminder-email templates (all language rows).
 *
 * The template source files render both shapes: getTemplate() adds the review
 * link block (primary CTA, portal link secondary); getTemplate({ reviewLink:
 * false }) reproduces the previous bodies exactly, which down() restores.
 * system_email_templates is a reference table (not tenant-distributed), so no
 * Citus-specific handling is needed. Tenant overrides are not touched.
 */

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: quoteEmail } = require('./utils/templates/email/quotes/quoteEmail.cjs');
const { getTemplate: quoteReminder } = require('./utils/templates/email/quotes/quoteReminder.cjs');

exports.up = async function up(knex) {
  await upsertEmailTemplate(knex, quoteEmail({ reviewLink: true }));
  await upsertEmailTemplate(knex, quoteReminder({ reviewLink: true }));
};

exports.down = async function down(knex) {
  await upsertEmailTemplate(knex, quoteEmail({ reviewLink: false }));
  await upsertEmailTemplate(knex, quoteReminder({ reviewLink: false }));
};
