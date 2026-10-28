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
  await knex.schema.alterTable(TABLE, (table) => {
    table.jsonb('where').notNullable().defaultTo('{"join":"and","clauses":[]}');
    table.smallint('where_version').notNullable().defaultTo(1);
  });
  // Materialize in JS before updating: Citus does not permit arbitrary column expressions in UPDATE.
  const rules = await knex(TABLE).select('tenant', 'apply_rule_id', ...COLUMNS);
  for (const rule of rules) {
    await knex(TABLE)
      .where({ tenant: rule.tenant, apply_rule_id: rule.apply_rule_id })
      .update({ where: JSON.stringify(legacyChecklistRuleToPredicate(rule)), where_version: 1 });
  }
  await knex.schema.alterTable(TABLE, (table) => {
    COLUMNS.forEach((column) => table.dropColumn(column));
  });
};

// Predicates (including tag targeting and nested groups) cannot be represented by the old columns.
exports.down = async function down() {
  throw new Error(
    'Checklist predicate format cannot be downgraded losslessly; restore a pre-migration backup.'
  );
};
