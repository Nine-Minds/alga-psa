const CLIENT_TYPE_CONSTRAINT = 'clients_client_type_check';
const VALID_CLIENT_TYPES = ['company', 'individual'];

async function normalizeExistingClientTypes(knex) {
  const rows = await knex('clients')
    .select('tenant', 'client_id', 'client_type')
    .where((query) => {
      query.whereNull('client_type').orWhereNotIn('client_type', VALID_CLIENT_TYPES);
    });

  for (const row of rows) {
    const normalized =
      typeof row.client_type === 'string' && row.client_type.trim().toLowerCase() === 'individual'
        ? 'individual'
        : 'company';

    await knex('clients')
      .where({ tenant: row.tenant, client_id: row.client_id })
      .update({ client_type: normalized });
  }
}

async function constraintExists(knex) {
  const result = await knex.raw(
    `SELECT 1
       FROM pg_constraint
      WHERE conname = ?
        AND conrelid = 'clients'::regclass`,
    [CLIENT_TYPE_CONSTRAINT]
  );
  return result.rows.length > 0;
}

exports.up = async function up(knex) {
  await normalizeExistingClientTypes(knex);

  await knex.raw("ALTER TABLE clients ALTER COLUMN client_type SET DEFAULT 'company'");
  await knex.raw('ALTER TABLE clients ALTER COLUMN client_type SET NOT NULL');

  if (!await constraintExists(knex)) {
    await knex.raw(`
      ALTER TABLE clients
      ADD CONSTRAINT ${CLIENT_TYPE_CONSTRAINT}
      CHECK (client_type IN ('company', 'individual'))
    `);
  }
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE clients DROP CONSTRAINT IF EXISTS ${CLIENT_TYPE_CONSTRAINT}`);
  await knex.raw('ALTER TABLE clients ALTER COLUMN client_type DROP NOT NULL');
  await knex.raw('ALTER TABLE clients ALTER COLUMN client_type DROP DEFAULT');
};
