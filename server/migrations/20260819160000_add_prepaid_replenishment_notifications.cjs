/** Seed the account-manager notification used when a replenishment invoice is created. */

exports.config = { transaction: false };

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplates } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { getTemplate: getEmailTemplate } = require('./utils/templates/email/billing/prepaidReplenishmentCreated.cjs');
const { TEMPLATES: internalTemplate } = require('./utils/templates/internal/prepaidReplenishmentCreated.cjs');

const MARKER_TABLE = 'migration_20260819160000_prepaid_replenishment_marker';

async function idByName(knex, table, name, column) {
  const row = await knex(table).where({ name }).first(column);
  return row?.[column] ?? null;
}

async function idsByName(knex, table, name, column) {
  const rows = await knex(table).where({ name }).select(column);
  return rows.map((row) => row[column]);
}

function mergedIds(existing, created) {
  return [...new Set([...(existing || []), ...(created || [])])];
}

exports.up = async function up(knex) {
  const markerExists = await knex.schema.hasTable(MARKER_TABLE);
  if (!markerExists) {
    await knex.schema.createTable(MARKER_TABLE, (table) => {
      table.text('marker_key').primary();
      table.jsonb('marker_value').notNullable();
    });
  }

  const marker = (await knex(MARKER_TABLE).where({ marker_key: 'created_ids' }).first('marker_value'))?.marker_value || {};
  const previous = typeof marker === 'string' ? JSON.parse(marker) : marker;
  const existingEmailSubtype = await idByName(knex, 'notification_subtypes', 'prepaid-replenishment-created', 'id');
  const existingInternalSubtype = await idByName(knex, 'internal_notification_subtypes', 'prepaid-replenishment-created', 'internal_notification_subtype_id');
  const existingEmailTemplates = await idsByName(knex, 'system_email_templates', 'prepaid-replenishment-created', 'id');
  const existingInternalTemplates = await idsByName(knex, 'internal_notification_templates', 'prepaid-replenishment-created', 'internal_notification_template_id');

  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertCategoriesAndSubtypes(knex);
  await upsertEmailTemplates(knex, [getEmailTemplate()]);
  await upsertInternalTemplates(knex, [internalTemplate]);

  const emailTemplateIds = await idsByName(knex, 'system_email_templates', 'prepaid-replenishment-created', 'id');
  const internalTemplateIds = await idsByName(knex, 'internal_notification_templates', 'prepaid-replenishment-created', 'internal_notification_template_id');
  await knex(MARKER_TABLE).insert({
    marker_key: 'created_ids',
    marker_value: {
      emailSubtypeId: previous.emailSubtypeId || (existingEmailSubtype ? null : await idByName(knex, 'notification_subtypes', 'prepaid-replenishment-created', 'id')),
      internalSubtypeId: previous.internalSubtypeId || (existingInternalSubtype ? null : await idByName(knex, 'internal_notification_subtypes', 'prepaid-replenishment-created', 'internal_notification_subtype_id')),
      emailTemplateIds: mergedIds(previous.emailTemplateIds, emailTemplateIds.filter((id) => !existingEmailTemplates.includes(id))),
      internalTemplateIds: mergedIds(previous.internalTemplateIds, internalTemplateIds.filter((id) => !existingInternalTemplates.includes(id))),
    },
  }).onConflict('marker_key').merge(['marker_value']);
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable(MARKER_TABLE)) {
    const marker = await knex(MARKER_TABLE).where({ marker_key: 'created_ids' }).first('marker_value');
    const raw = marker?.marker_value ?? {};
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (value.emailTemplateIds?.length) {
      await knex('system_email_templates').whereIn('id', value.emailTemplateIds).del();
    }
    if (value.internalTemplateIds?.length) {
      await knex('internal_notification_templates').whereIn('internal_notification_template_id', value.internalTemplateIds).del();
    }
    if (value.emailSubtypeId) {
      const references = await knex('system_email_templates').where({ notification_subtype_id: value.emailSubtypeId }).count('* as count').first();
      if (Number(references?.count ?? 0) === 0) await knex('notification_subtypes').where({ id: value.emailSubtypeId }).del();
    }
    if (value.internalSubtypeId) {
      const references = await knex('internal_notification_templates').where({ subtype_id: value.internalSubtypeId }).count('* as count').first();
      if (Number(references?.count ?? 0) === 0) {
        await knex('internal_notification_subtypes').where({ internal_notification_subtype_id: value.internalSubtypeId }).del();
      }
    }
    await knex.schema.dropTableIfExists(MARKER_TABLE);
  }
};
