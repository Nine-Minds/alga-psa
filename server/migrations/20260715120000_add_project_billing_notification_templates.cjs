'use strict';

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { getTemplate: getMilestoneReadyTemplate } = require('./utils/templates/email/projects/projectMilestoneReady.cjs');
const { getTemplate: getBudgetThresholdTemplate } = require('./utils/templates/email/projects/projectBudgetThresholdReached.cjs');
const { TEMPLATES: PROJECT_TEMPLATES } = require('./utils/templates/internal/projects.cjs');

const INTERNAL_NAMES = [
  'project-milestone-ready',
  'project-budget-threshold-reached',
];

exports.up = async function up(knex) {
  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, getMilestoneReadyTemplate());
  await upsertEmailTemplate(knex, getBudgetThresholdTemplate());
  await upsertCategoriesAndSubtypes(knex);
  await upsertInternalTemplates(
    knex,
    PROJECT_TEMPLATES.filter((template) => INTERNAL_NAMES.includes(template.templateName))
  );
};

exports.down = async function down(knex) {
  await knex('system_email_templates').whereIn('name', INTERNAL_NAMES).del();
  await knex('notification_subtypes').whereIn('name', [
    'Project Milestone Ready',
    'Project Budget Threshold Reached',
  ]).del();
  await knex('internal_notification_templates').whereIn('name', INTERNAL_NAMES).del();
  await knex('internal_notification_subtypes').whereIn('name', INTERNAL_NAMES).del();
};
