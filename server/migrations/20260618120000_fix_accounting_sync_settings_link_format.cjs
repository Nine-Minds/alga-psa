/**
 * Migration: fix the accounting-sync exception form so completing a task no
 * longer fails validation.
 *
 * The shared `accounting-sync-exception-form` declared `settingsLink` with
 * `format: 'uri'`, but its default value is a relative app link
 * (`/msp/settings?tab=integrations&category=accounting`). AJV's strict `uri`
 * format requires an absolute URI, so RJSF rejected the form on submit with
 * `must match format "uri"`. The correct format for a same-origin relative
 * link is `uri-reference`. This patches any form definition already created by
 * 20260611100200 (idempotent).
 */

const FORM_NAME = 'accounting-sync-exception-form';

function parseSchema(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function setSettingsLinkFormat(knex, from, to) {
  const form = await knex('system_workflow_form_definitions').where({ name: FORM_NAME }).first();
  if (!form) return;

  const schema = parseSchema(form.json_schema);
  if (schema?.properties?.settingsLink?.format !== from) return;

  schema.properties.settingsLink.format = to;
  await knex('system_workflow_form_definitions')
    .where({ name: FORM_NAME })
    .update({ json_schema: JSON.stringify(schema), updated_at: new Date() });
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await setSettingsLinkFormat(knex, 'uri', 'uri-reference');
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await setSettingsLinkFormat(knex, 'uri-reference', 'uri');
};
