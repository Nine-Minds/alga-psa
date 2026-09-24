/**
 * Add Swedish internal notification templates.
 *
 * Upserts the `sv` variants from the internal notification source-of-truth
 * files. Idempotent via (name, language_code).
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { TEMPLATES: ticketTemplates } = require('./utils/templates/internal/tickets.cjs');
const { TEMPLATES: projectTemplates } = require('./utils/templates/internal/projects.cjs');
const { TEMPLATES: invoiceTemplates } = require('./utils/templates/internal/invoices.cjs');
const { TEMPLATES: systemTemplates } = require('./utils/templates/internal/system.cjs');
const { TEMPLATES: appointmentTemplates } = require('./utils/templates/internal/appointments.cjs');
const { TEMPLATES: slaTemplates } = require('./utils/templates/internal/sla.cjs');
const { TEMPLATES: inventoryTemplates } = require('./utils/templates/internal/inventory.cjs');
const { TEMPLATES: opportunityTemplates } = require('./utils/templates/internal/opportunities.cjs');
const { TEMPLATES: prepaidBalanceTemplates } = require('./utils/templates/internal/prepaidBalanceAlerts.cjs');
const { TEMPLATES: prepaidReplenishmentTemplate } = require('./utils/templates/internal/prepaidReplenishmentCreated.cjs');
const { TEMPLATES: rmmTemplates } = require('./utils/templates/internal/rmm.cjs');

const ALL_TEMPLATES = [
  ...ticketTemplates,
  ...projectTemplates,
  ...invoiceTemplates,
  ...systemTemplates,
  ...appointmentTemplates,
  ...slaTemplates,
  ...inventoryTemplates,
  ...opportunityTemplates,
  ...prepaidBalanceTemplates,
  prepaidReplenishmentTemplate,
  ...rmmTemplates,
];

function buildSwedishInternalTemplateDefs() {
  return ALL_TEMPLATES.map((template) => {
    const sv = template.translations.sv;
    if (!sv) {
      throw new Error(`Internal template '${template.templateName}' must define a sv translation`);
    }
    return {
      ...template,
      translations: {
        sv,
      },
    };
  });
}

function templateNames() {
  return buildSwedishInternalTemplateDefs().map((template) => template.templateName);
}

function buildSwedishRows(subtypes) {
  const subtypeIdsByName = new Map(subtypes.map((subtype) => [subtype.name, subtype.internal_notification_subtype_id]));

  return buildSwedishInternalTemplateDefs().map((template) => {
    const subtypeId = subtypeIdsByName.get(template.subtypeName);
    if (!subtypeId) {
      throw new Error(`Internal notification subtype '${template.subtypeName}' not found for template '${template.templateName}'`);
    }

    return {
      name: template.templateName,
      language_code: 'sv',
      title: template.translations.sv.title,
      message: template.translations.sv.message,
      subtype_id: subtypeId,
    };
  });
}

async function upsertSwedishInternalRows(knex, rows) {
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

async function deleteSwedishInternalRows(knex) {
  await knex('internal_notification_templates')
    .where({ language_code: 'sv' })
    .whereIn('name', templateNames())
    .del();
}

exports.up = async function up(knex) {
  await upsertCategoriesAndSubtypes(knex);
  const subtypes = await knex('internal_notification_subtypes')
    .select('internal_notification_subtype_id', 'name');
  const rows = buildSwedishRows(subtypes);
  await upsertSwedishInternalRows(knex, rows);
  console.log(`Added/updated ${rows.length} Swedish internal notification templates.`);
};

exports.down = async function down(knex) {
  await deleteSwedishInternalRows(knex);
};

exports.ALL_TEMPLATES = ALL_TEMPLATES;
exports.buildSwedishInternalTemplateDefs = buildSwedishInternalTemplateDefs;
exports.buildSwedishRows = buildSwedishRows;
exports.templateNames = templateNames;
exports.upsertSwedishInternalRows = upsertSwedishInternalRows;
exports.deleteSwedishInternalRows = deleteSwedishInternalRows;

// Citus: category/subtype upserts cannot share a transaction with a parallel
// multi-shard operation from an earlier migration. These upserts are idempotent.
exports.config = { transaction: false };
