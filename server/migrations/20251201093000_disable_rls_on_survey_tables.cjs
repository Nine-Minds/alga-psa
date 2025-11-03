const TABLES = [
  'survey_templates',
  'survey_triggers',
  'survey_invitations',
  'survey_responses',
];

const POLICIES = {
  survey_templates: ['tenant_isolation'],
  survey_triggers: ['tenant_isolation'],
  survey_invitations: ['tenant_isolation'],
  survey_responses: ['tenant_isolation'],
};

exports.up = async function up(knex) {
  for (const table of TABLES) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      continue;
    }
    await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }

  for (const [table, policies] of Object.entries(POLICIES)) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      continue;
    }
    for (const policy of policies) {
      await knex.raw(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
    }
  }
};

exports.down = async function down(knex) {
  for (const table of TABLES) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      continue;
    }
    await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  }
};
