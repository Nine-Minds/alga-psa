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
  if (!(await knex.schema.hasColumn(TABLE, 'where'))) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.jsonb('where').notNullable().defaultTo('{"join":"and","clauses":[]}');
    });
  }
  if (!(await knex.schema.hasColumn(TABLE, 'where_version'))) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.smallint('where_version').notNullable().defaultTo(1);
    });
  }
  // A completed migration may be invoked again by setup/recovery tooling.
  if (!(await knex.schema.hasColumn(TABLE, 'board_id'))) return;

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
  await knex.schema.alterTable(TABLE, (table) => {
  // migration-lint: allow 3 - all legacy values have been converted to the versioned predicate above; retaining two writable formats would permit drift
    COLUMNS.forEach((column) => table.dropColumn(column));
  });
};

// Predicates (including tag targeting and nested groups) cannot be represented by the old columns.
exports.down = async function down() {
  throw new Error(
    'Checklist predicate format cannot be downgraded losslessly; restore a pre-migration backup.'
  );
};
