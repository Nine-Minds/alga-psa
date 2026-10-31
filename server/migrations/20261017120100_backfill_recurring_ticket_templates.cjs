'use strict';

/**
 * Migration B (data) for "recurring tickets on ticket templates".
 *
 * For every recurring_ticket_definitions row without a ticket_template_id, create the
 * ticket_templates row that carries the same content, copy the referenced checklist template's
 * current items into ticket_template_checklist_items (R6), and link the definition to it.
 *
 *   - per tenant, in batches of BATCH_SIZE definitions, one transaction per batch (a single tenant's
 *     rows live on one Citus shard, so a batch is a single-shard transaction);
 *   - idempotent: only definitions with ticket_template_id IS NULL are selected, and the template insert
 *     and the link update commit together, so a crash re-runs cleanly;
 *   - the mapping (names, description, items) is the pure function in utils/recurringTemplateMapping.cjs;
 *   - the legacy content columns are left untouched. status, assignment and the (empty) definition
 *     overrides stay on the definition, so effective ticket fields are byte-identical (R7).
 *
 * Down: copies the (possibly edited) template content back into any definition column that is empty, then
 * unlinks the definitions and removes the templates this migration created.
 */

const { tenantDb } = require('./utils/tenantDb.cjs');
const { mapDefinitionToTemplate, MIGRATION_NOTE_PREFIX } = require('./utils/recurringTemplateMapping.cjs');

const BATCH_SIZE = 200;
const DEFINITIONS = 'recurring_ticket_definitions';
const TEMPLATES = 'ticket_templates';
const ITEMS = 'ticket_template_checklist_items';

async function activeNames(trx, tenant) {
  const rows = await tenantDb(trx, tenant).table(TEMPLATES).where({ is_active: true }).select('name');
  return new Set(rows.map((row) => String(row.name).toLowerCase()));
}

async function migrateBatch(knex, tenant) {
  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const definitions = await db
      .table(DEFINITIONS)
      .whereNull('ticket_template_id')
      .orderBy('created_at', 'asc')
      .orderBy('definition_id', 'asc')
      .limit(BATCH_SIZE)
      .forUpdate()
      .select('*');
    if (definitions.length === 0) return 0;

    const taken = await activeNames(trx, tenant);
    const checklistIds = [...new Set(definitions.map((d) => d.checklist_template_id).filter(Boolean))];
    const checklistRows = checklistIds.length
      ? await db.table('checklist_template_items').whereIn('template_id', checklistIds).select('*')
      : [];

    for (const definition of definitions) {
      const { template, items } = mapDefinitionToTemplate(
        definition,
        checklistRows.filter((row) => row.template_id === definition.checklist_template_id),
        taken
      );
      const [{ template_id: templateId }] = await db
        .table(TEMPLATES)
        .insert({
          tenant,
          ...template,
          created_by: definition.created_by ?? null,
          updated_by: definition.created_by ?? null,
        })
        .returning('template_id');
      if (items.length > 0) {
        await db.table(ITEMS).insert(items.map((item) => ({ tenant, template_id: templateId, ...item })));
      }
      await db
        .table(DEFINITIONS)
        .where({ definition_id: definition.definition_id })
        .update({ ticket_template_id: templateId });
    }
    return definitions.length;
  });
}

exports.up = async function up(knex) {
  const tenants = await knex(DEFINITIONS).whereNull('ticket_template_id').distinct('tenant');
  for (const { tenant } of tenants) {
    // Each pass migrates the definitions still unlinked, so the loop ends on its own and a re-run is a no-op.
    // eslint-disable-next-line no-await-in-loop
    while ((await migrateBatch(knex, tenant)) > 0) { /* next batch */ }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex(TEMPLATES)
    .where('notes', 'like', `${MIGRATION_NOTE_PREFIX}%`)
    .where({ offer_for_manual_use: false })
    .distinct('tenant');
  for (const { tenant } of tenants) {
    // eslint-disable-next-line no-await-in-loop
    await knex.transaction(async (trx) => {
      const migrated = trx.raw(
        `SELECT template_id FROM ${TEMPLATES}
         WHERE tenant = ? AND offer_for_manual_use = false AND notes LIKE ?`,
        [tenant, `${MIGRATION_NOTE_PREFIX}%`]
      );
      const ids = (await migrated).rows.map((row) => row.template_id);
      if (ids.length === 0) return;

      await trx.raw(
        `UPDATE ${DEFINITIONS} d
         SET title_template = COALESCE(d.title_template, t.title),
             description = CASE WHEN d.description IS NULL AND t.description LIKE '[%'
                                THEN t.description::jsonb ELSE d.description END,
             board_id = COALESCE(d.board_id, t.board_id),
             priority_id = COALESCE(d.priority_id, t.priority_id),
             category_id = COALESCE(d.category_id, t.category_id),
             subcategory_id = COALESCE(d.subcategory_id, t.subcategory_id),
             ticket_template_id = NULL
         FROM ${TEMPLATES} t
         WHERE d.tenant = ? AND t.tenant = d.tenant AND t.template_id = d.ticket_template_id
           AND d.ticket_template_id = ANY(?::uuid[])`,
        [tenant, ids]
      );
      await tenantDb(trx, tenant).table(ITEMS).whereIn('template_id', ids).delete();
      await tenantDb(trx, tenant).table(TEMPLATES).whereIn('template_id', ids).delete();
    });
  }
};

exports.config = { transaction: false };
