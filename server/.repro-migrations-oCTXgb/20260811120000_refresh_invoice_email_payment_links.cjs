/**
 * Forward migration: refresh the system invoice-email template so every
 * locale renders the payment and client-portal CTAs.
 *
 * The source of truth is server/migrations/utils/templates/email/invoices/invoiceEmail.cjs.
 * This migration re-upserts the system template rows (system_email_templates)
 * only; tenant-authored templates live in tenant_email_templates and are
 * intentionally left untouched.
 */

const { getTemplate: invoiceEmail } = require('./utils/templates/email/invoices/invoiceEmail.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

exports.up = async function (knex) {
  console.log('Refreshing system invoice-email templates with payment/portal CTAs...');
  await upsertEmailTemplate(knex, invoiceEmail());
  console.log('  ✓ invoice-email system templates refreshed');
};

exports.down = async function () {
  // No-op: prior migrations contain the older template content. Rolling back
  // this migration simply leaves the refreshed system template in place.
};
