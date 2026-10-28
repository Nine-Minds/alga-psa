/**
 * Register the msp-tenant-recovery email template (CM T0-5b, alga-2026-0002894).
 *
 * Sent to MSP (internal) users whose email is used in more than one
 * organization: one scoped /auth/msp/signin?tenant=<slug> link per
 * organization. Idempotent: upserts the notification subtype and every
 * language variant from the source-of-truth file.
 */

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: mspTenantRecovery, TEMPLATE_NAME } = require('./utils/templates/email/auth/mspTenantRecovery.cjs');

exports.up = async function up(knex) {
  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, mspTenantRecovery());
};

exports.down = async function down(knex) {
  await knex('system_email_templates').where({ name: TEMPLATE_NAME }).del();
};

// Citus: category/subtype upserts cannot share a transaction with a parallel
// multi-shard operation from an earlier migration. These upserts are idempotent.
exports.config = { transaction: false };
