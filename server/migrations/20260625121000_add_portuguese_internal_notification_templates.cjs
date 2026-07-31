/**
 * Add Brazilian Portuguese internal notification templates.
 *
 * Upserts the `pt` variants from the internal notification source-of-truth
 * files. Idempotent via (name, language_code).
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { TEMPLATES: ticketTemplates } = require('./utils/templates/internal/tickets.cjs');
const { TEMPLATES: projectTemplates } = require('./utils/templates/internal/projects.cjs');
const { TEMPLATES: invoiceTemplates } = require('./utils/templates/internal/invoices.cjs');
const { TEMPLATES: systemTemplates } = require('./utils/templates/internal/system.cjs');
const { TEMPLATES: appointmentTemplates } = require('./utils/templates/internal/appointments.cjs');
const { TEMPLATES: slaTemplates } = require('./utils/templates/internal/sla.cjs');

const ALL_TEMPLATES = [
  ...ticketTemplates,
  ...projectTemplates,
  ...invoiceTemplates,
  ...systemTemplates,
  ...appointmentTemplates,
  ...slaTemplates,
];

function buildPortugueseInternalTemplateDefs() {
  return ALL_TEMPLATES.map((template) => {
    const pt = template.translations.pt;
    if (!pt) {
      throw new Error(`Internal template '${template.templateName}' must define a pt translation`);
    }
    return {
      ...template,
      translations: {
        pt,
      },
    };
  });
}

function templateNames() {
  return buildPortugueseInternalTemplateDefs().map((template) => template.templateName);
}

function buildPortugueseRows(subtypes) {
  const subtypeIdsByName = new Map(subtypes.map((subtype) => [subtype.name, subtype.internal_notification_subtype_id]));

  return buildPortugueseInternalTemplateDefs().map((template) => {
    const subtypeId = subtypeIdsByName.get(template.subtypeName);
    if (!subtypeId) {
      throw new Error(`Internal notification subtype '${template.subtypeName}' not found for template '${template.templateName}'`);
    }

    return {
      name: template.templateName,
      language_code: 'pt',
      title: template.translations.pt.title,
      message: template.translations.pt.message,
      subtype_id: subtypeId,
    };
  });
}

async function upsertPortugueseInternalRows(knex, rows) {
  if (rows.length === 0) return;
  await knex('internal_notification_templates')
    .insert(rows)
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('excluded.title'),
      message: knex.raw('excluded.message'),
      subtype_id: knex.raw('excluded.subtype_id'),
    });
}

async function deletePortugueseInternalRows(knex) {
  await knex('internal_notification_templates')
    .where({ language_code: 'pt' })
    .whereIn('name', templateNames())
    .del();
}

exports.up = async function up(knex) {
  await upsertCategoriesAndSubtypes(knex);
  const subtypes = await knex('internal_notification_subtypes')
    .select('internal_notification_subtype_id', 'name');
  const rows = buildPortugueseRows(subtypes);
  await upsertPortugueseInternalRows(knex, rows);
  console.log(`Added/updated ${rows.length} Brazilian Portuguese internal notification templates.`);
};

exports.down = async function down(knex) {
  await deletePortugueseInternalRows(knex);
};

exports.ALL_TEMPLATES = ALL_TEMPLATES;
exports.buildPortugueseInternalTemplateDefs = buildPortugueseInternalTemplateDefs;
exports.buildPortugueseRows = buildPortugueseRows;
exports.templateNames = templateNames;
exports.upsertPortugueseInternalRows = upsertPortugueseInternalRows;
exports.deletePortugueseInternalRows = deletePortugueseInternalRows;
