'use strict';

const { legacyChecklistRuleToPredicate } = require('./utils/checklistRulePredicate.cjs');
const { installChecklistTextFunctions } = require('./utils/checklistTextSql.cjs');

const TABLE = 'checklist_template_apply_rules';
const COLUMNS = [
  'board_id',
  'category_id',
  'subcategory_id',
  'priority_id',
  'client_ids',
  'ticket_origins',
  'from_service_request',
  'service_request_definition_id',
  'keywords',
  'keyword_mode',
  'keyword_target',
];

exports.up = async function up(knex) {
  await installChecklistTextFunctions(knex);
  const alreadyExpanded = await knex.schema.hasColumn(TABLE, 'where');
  if (!alreadyExpanded) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.jsonb('where').notNullable().defaultTo('{"join":"and","clauses":[]}');
    });
  }
  if (!(await knex.schema.hasColumn(TABLE, 'where_version'))) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.smallint('where_version').notNullable().defaultTo(1);
    });
  }
  // The migration is transactional. Once expanded, recovery must preserve predicate edits.
  if (alreadyExpanded) return;

  // Bound memory while materializing in JS: Citus disallows arbitrary UPDATE expressions.
  let cursor;
  while (true) {
    const query = knex(TABLE).select('tenant', 'apply_rule_id', ...COLUMNS)
      .orderBy('tenant').orderBy('apply_rule_id').limit(500);
    if (cursor) query.whereRaw('(tenant, apply_rule_id) > (?, ?)', cursor);
    const rules = await query;
    if (!rules.length) break;
    for (const rule of rules) {
      await knex(TABLE)
        .where({ tenant: rule.tenant, apply_rule_id: rule.apply_rule_id })
        .update({ where: JSON.stringify(legacyChecklistRuleToPredicate(rule)), where_version: 1 });
    }
    const last = rules[rules.length - 1];
    cursor = [last.tenant, last.apply_rule_id];
  }
  // Keep legacy columns, constraints and values for N-1 rule CRUD during blue/green upgrades.
  // Their removal requires a later release whose baseline no longer reads or writes them.
};

// Predicates (including tag targeting and nested groups) cannot be represented by the old columns.
exports.down = async function down() {
  throw new Error(
    'Checklist predicate format cannot be downgraded losslessly; restore a pre-migration backup.'
  );
};
