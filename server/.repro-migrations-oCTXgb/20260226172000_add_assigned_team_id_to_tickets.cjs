/**
 * Add assigned_team_id column to tickets.
 *
 * NOTE: tickets is distributed in Citus, so ALTER TABLE must run outside a transaction.
 */
const isCitusEnabled = async (knex) => {
  const { rows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  return rows.length > 0;
};

const ensureDistributed = async (knex, tableName, distributionColumn) => {
  if (!(await isCitusEnabled(knex))) return;
  const { rows } = await knex.raw(
    'SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass LIMIT 1',
    [tableName]
  );
  if (rows.length > 0) return;
  await knex.raw('SELECT create_distributed_table(?, ?)', [tableName, distributionColumn]);
};

exports.up = async function up(knex) {
  // tickets is distributed on Citus, so teams must be distributed before it
  // can be FK'd. No-op on plain Postgres and on clusters that already have it.
  await ensureDistributed(knex, 'teams', 'tenant');

  // Column and FK guarded separately: with transaction:false a failed FK
  // attempt leaves the column behind, and a combined guard would then skip
  // the FK forever.
  const hasAssignedTeam = await knex.schema.hasColumn('tickets', 'assigned_team_id');
  if (!hasAssignedTeam) {
    await knex.schema.alterTable('tickets', (table) => {
      table.uuid('assigned_team_id').nullable();
    });
  }

  const { rows } = await knex.raw(
    "SELECT 1 FROM pg_constraint WHERE conname = 'tickets_tenant_assigned_team_id_foreign' LIMIT 1"
  );
  if (rows.length === 0) {
    await knex.schema.alterTable('tickets', (table) => {
      table.foreign(['tenant', 'assigned_team_id']).references(['tenant', 'team_id']).inTable('teams');
    });
  }
};

exports.down = async function down(knex) {
  const hasAssignedTeam = await knex.schema.hasColumn('tickets', 'assigned_team_id');
  if (!hasAssignedTeam) {
    return;
  }

  await knex.schema.alterTable('tickets', (table) => {
    table.dropColumn('assigned_team_id');
  });
};

exports.config = { transaction: false };
