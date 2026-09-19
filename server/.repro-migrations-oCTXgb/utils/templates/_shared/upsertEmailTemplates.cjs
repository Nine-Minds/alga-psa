/**
 * Upsert utility for system_email_templates.
 *
 * Used by both migrations and seeds to insert or update email templates
 * from the source-of-truth template files.
 */

/**
 * Upsert one email template (all language variants) into system_email_templates.
 *
 * @param {import('knex').Knex} knex
 * @param {Object} templateDef - Template definition from a source file's getTemplate()
 * @param {string} templateDef.templateName   - e.g., 'ticket-created'
 * @param {string} templateDef.subtypeName    - notification_subtypes.name for FK lookup
 * @param {Array<{language: string, subject: string, htmlContent: string, textContent: string}>} templateDef.translations
 * @param {Object} [options]
 * @param {boolean} [options.skipMissingSubtype=false] - Warn and skip instead of throwing if subtype not found
 */
async function upsertEmailTemplate(knex, templateDef, options = {}) {
  const { templateName, subtypeName, translations } = templateDef;

  const subtype = await knex('notification_subtypes')
    .where({ name: subtypeName })
    .first();

  if (!subtype) {
    if (options.skipMissingSubtype) {
      console.warn(`[upsertEmailTemplate] Subtype '${subtypeName}' not found, skipping '${templateName}'`);
      return;
    }
    throw new Error(`Notification subtype '${subtypeName}' not found for template '${templateName}'`);
  }

  const now = new Date();
  const rows = translations.map(t => ({
    name: templateName,
    language_code: t.language,
    subject: t.subject,
    html_content: t.htmlContent,
    text_content: t.textContent,
    notification_subtype_id: subtype.id,
    updated_at: now,
  }));

  await knex('system_email_templates')
    .insert(rows)
    .onConflict(['name', 'language_code'])
    .merge(['subject', 'html_content', 'text_content', 'notification_subtype_id', 'updated_at']);
}

/**
 * Upsert multiple email templates at once.
 *
 * @param {import('knex').Knex} knex
 * @param {Array<Object>} templateDefs - Array of template definitions from getTemplate()
 * @param {Object} [options]
 * @param {boolean} [options.skipMissingSubtype=false]
 */
async function upsertEmailTemplates(knex, templateDefs, options = {}) {
  for (const def of templateDefs) {
    await upsertEmailTemplate(knex, def, options);
  }
}

/**
 * Delete all language variants of an email template by name.
 *
 * @param {import('knex').Knex} knex
 * @param {string} templateName
 */
async function deleteEmailTemplate(knex, templateName) {
  await knex('system_email_templates').where({ name: templateName }).del();
}

module.exports = { upsertEmailTemplate, upsertEmailTemplates, deleteEmailTemplate };
