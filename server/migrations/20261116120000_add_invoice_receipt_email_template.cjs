/**
 * Data-only migration: add the system 'invoice-receipt-email' template, sent
 * when an already-paid invoice is emailed. Source of truth:
 * server/migrations/utils/templates/email/invoices/invoiceReceiptEmail.cjs.
 *
 * Idempotent (upsert on name + language_code). Touches system_email_templates
 * only; tenant templates are untouched. No schema change, so nothing to
 * distribute for Citus.
 */

const { getTemplate: invoiceReceiptEmail, TEMPLATE_NAME } = require('./utils/templates/email/invoices/invoiceReceiptEmail.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

exports.up = async function (knex) {
  await upsertEmailTemplate(knex, invoiceReceiptEmail());
};

exports.down = async function (knex) {
  await knex('system_email_templates').where({ name: TEMPLATE_NAME }).del();
};
