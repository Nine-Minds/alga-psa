'use strict';

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: getProjectStatusUpdateTemplate } = require('./utils/templates/email/projects/projectStatusUpdate.cjs');

const TEMPLATE_NAME = 'project-status-update';
const SUBTYPE_NAME = 'Project Status Update';

// Upserts into notification_categories/notification_subtypes (Citus reference
// tables) cannot share a transaction with parallel distributed operations from
// earlier migrations in the same knex batch — knex wraps the whole batch in one
// transaction when every migration uses transactions, and Citus rejects
// reference-table writes after a parallel operation on a distributed table.
// All statements below are idempotent upserts, so per-statement commit is safe.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, getProjectStatusUpdateTemplate());
};

exports.down = async function down(knex) {
  await knex('system_email_templates').where({ name: TEMPLATE_NAME }).del();
  await knex('notification_subtypes').where({ name: SUBTYPE_NAME }).del();
};
