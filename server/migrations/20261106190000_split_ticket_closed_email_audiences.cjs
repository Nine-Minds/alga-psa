const { tenantDb } = require('./utils/tenantDb.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const {
  getClientTemplate,
  getInternalTemplate,
} = require('./utils/templates/_shared/ticketClosedAudience.cjs');

const audiences = [
  { subtype: 'Ticket Closed Client', template: 'ticket-closed-client', getTemplate: getClientTemplate },
  { subtype: 'Ticket Closed Internal', template: 'ticket-closed-internal', getTemplate: getInternalTemplate },
];

exports.config = { transaction: false };

exports.up = async function up(knex) {
  const category = await knex('notification_categories').where({ name: 'Tickets' }).first();
  if (!category) throw new Error('Cannot split ticket-closed emails: Tickets notification category is missing');

  const legacy = await knex('notification_subtypes')
    .where({ category_id: category.id, name: 'Ticket Closed' })
    .first();
  for (const audience of audiences) {
    // migration-lint: allow 5 - two new subtype rows only, one per audience, loop-bounded by the static audience list
    await knex('notification_subtypes').insert({
      category_id: category.id,
      name: audience.subtype,
      description: `When a ticket is closed (${audience.template.endsWith('-client') ? 'client-facing' : 'internal'})`,
      is_enabled: legacy?.is_enabled ?? true,
      is_default_enabled: legacy?.is_default_enabled ?? true,
    }).onConflict(['category_id', 'name']).ignore();
    await upsertEmailTemplate(knex, audience.getTemplate());
  }

  const subtypes = await knex('notification_subtypes')
    .where({ category_id: category.id })
    .whereIn('name', audiences.map((audience) => audience.subtype))
    .select('id', 'name');
  const subtypeIds = new Map(subtypes.map((subtype) => [subtype.name, subtype.id]));
  const systemTemplates = await knex('system_email_templates')
    .whereIn('name', audiences.map((audience) => audience.template))
    .select('id', 'name', 'language_code');
  const systemIds = new Map(systemTemplates.map((template) => [`${template.name}:${template.language_code}`, template.id]));
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    await knex.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [tenant]);
      const db = tenantDb(trx, tenant);
      const [oldSetting, oldPreferences, oldTemplates] = await Promise.all([
        legacy ? db.table('tenant_notification_subtype_settings').where({ subtype_id: legacy.id }).first() : null,
        legacy ? db.table('user_notification_preferences').where({ subtype_id: legacy.id }) : [],
        db.table('tenant_email_templates').where({ name: 'ticket-closed' }),
      ]);

      for (const audience of audiences) {
        const subtypeId = subtypeIds.get(audience.subtype);
        if (!subtypeId) throw new Error(`Missing notification subtype ${audience.subtype}`);

        if (oldSetting) {
          // migration-lint: allow 5 - copies a single legacy setting row per tenant and audience; at most two inserts per tenant
          await db.table('tenant_notification_subtype_settings').insert({
            tenant,
            subtype_id: subtypeId,
            is_enabled: oldSetting.is_enabled,
            is_default_enabled: oldSetting.is_default_enabled,
          }).onConflict(['tenant', 'subtype_id']).ignore();
        }

        if (oldPreferences.length) {
          // migration-lint: allow 5 - per-tenant copy of legacy opt-in rows, bounded by that tenant's user count and run one tenant per transaction
          await db.table('user_notification_preferences').insert(oldPreferences.map((preference) => ({
            tenant,
            user_id: preference.user_id,
            subtype_id: subtypeId,
            is_enabled: preference.is_enabled,
            email_address: preference.email_address,
            frequency: preference.frequency,
          }))).onConflict(['tenant', 'user_id', 'subtype_id']).ignore();
        }

        if (oldTemplates.length) {
          // migration-lint: allow 5 - per-tenant copy of customised ticket-closed templates, bounded by installed languages and run one tenant per transaction
          await db.table('tenant_email_templates').insert(oldTemplates.map((template) => ({
            tenant,
            name: audience.template,
            language_code: template.language_code,
            subject: template.subject,
            html_content: template.html_content,
            text_content: template.text_content,
            system_template_id: systemIds.get(`${audience.template}:${template.language_code}`) ?? null,
            created_at: template.created_at,
            updated_at: template.updated_at,
          }))).onConflict(['tenant', 'name', 'language_code']).ignore();
        }
      }
    });
  }
};

exports.down = async function down() {
  // The legacy rows and all history remain intact. Removing the new subtypes
  // would cascade into preferences and logs created after this migration.
};
