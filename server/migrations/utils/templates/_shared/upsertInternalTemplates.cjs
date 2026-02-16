/**
 * Upsert utility for internal_notification_templates.
 *
 * Used by both migrations and seeds to insert or update internal notification
 * templates from the source-of-truth template files.
 */

/**
 * Upsert one internal notification template (all language variants).
 *
 * @param {import('knex').Knex} knex
 * @param {Object} templateDef
 * @param {string} templateDef.templateName   - e.g., 'ticket-assigned'
 * @param {string} templateDef.subtypeName    - internal_notification_subtypes.name for FK lookup
 * @param {Object<string, {title: string, message: string}>} templateDef.translations
 *   Keyed by language code, e.g., { en: { title: '...', message: '...' }, fr: { ... } }
 * @param {Object} [options]
 * @param {boolean} [options.skipMissingSubtype=false]
 */
async function upsertInternalTemplate(knex, templateDef, options = {}) {
  const { templateName, subtypeName, translations } = templateDef;

  const subtype = await knex('internal_notification_subtypes')
    .where({ name: subtypeName })
    .first();

  if (!subtype) {
    if (options.skipMissingSubtype) {
      console.warn(`[upsertInternalTemplate] Subtype '${subtypeName}' not found, skipping '${templateName}'`);
      return;
    }
    throw new Error(`Internal notification subtype '${subtypeName}' not found for template '${templateName}'`);
  }

  const rows = Object.entries(translations).map(([lang, { title, message }]) => ({
    name: templateName,
    language_code: lang,
    title,
    message,
    subtype_id: subtype.internal_notification_subtype_id,
  }));

  await knex('internal_notification_templates')
    .insert(rows)
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('excluded.title'),
      message: knex.raw('excluded.message'),
      subtype_id: knex.raw('excluded.subtype_id'),
    });
}

/**
 * Upsert multiple internal notification templates at once.
 *
 * @param {import('knex').Knex} knex
 * @param {Array<Object>} templateDefs - Array of template definitions
 * @param {Object} [options]
 * @param {boolean} [options.skipMissingSubtype=false]
 */
async function upsertInternalTemplates(knex, templateDefs, options = {}) {
  for (const def of templateDefs) {
    await upsertInternalTemplate(knex, def, options);
  }
}

/**
 * Delete all language variants of an internal notification template.
 *
 * @param {import('knex').Knex} knex
 * @param {string} templateName
 */
async function deleteInternalTemplate(knex, templateName) {
  await knex('internal_notification_templates').where({ name: templateName }).del();
}

module.exports = { upsertInternalTemplate, upsertInternalTemplates, deleteInternalTemplate };
