// Smoke-test only (not for commit).
//
// The from-scratch Citus chain leaves bucket_usage as a plain local table, so
// the `usageCitusDistributed` branch of 20260814090000 — the two
// run_command_on_shards calls that commit 8ff85f1684 split into one command per
// call — never runs in CI. The hosted cluster DOES have bucket_usage
// distributed, which is where the "too few arguments for format()" failure came
// from. This replays the real migration's exports.up() against the real
// single-node Citus with bucket_usage distributed, so that branch executes.
import knexFactory from 'knex';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migration = require('../../server/migrations/20260814090000_create_contract_line_buckets.cjs');

const knex = knexFactory({
  client: 'pg',
  connection: {
    host: 'localhost',
    port: 55445,
    user: 'postgres',
    password: 'citus_test',
    database: 'server',
  },
  pool: { min: 1, max: 5 },
});

const say = (...a) => console.log(...a);

try {
  const before = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'bucket_usage'::regclass) AS d`
  );
  say('bucket_usage distributed before:', before.rows[0].d);

  if (!before.rows[0].d) {
    await knex.raw(
      `SELECT create_distributed_table('bucket_usage', 'tenant', colocate_with => 'contract_lines')`
    );
    say('distributed bucket_usage colocated with contract_lines');
  }

  // Prove the shards exist and are the ones the migration will rewrite.
  const shards = await knex.raw(
    `SELECT count(*)::int AS n FROM pg_dist_shard WHERE logicalrelid = 'bucket_usage'::regclass`
  );
  say('bucket_usage shard count:', shards.rows[0].n);

  // Re-run the real migration. It is written to be re-runnable, and 3i's
  // run_command_on_shards block is unconditional on the Citus side.
  say('--- replaying exports.up() ---');
  await migration.up(knex);
  say('--- exports.up() returned cleanly ---');

  const coord = await knex.raw(
    `SELECT attname, format_type(atttypid, atttypmod) AS t
       FROM pg_attribute
      WHERE attrelid = 'bucket_usage'::regclass
        AND attname IN ('minutes_used','overage_minutes')
      ORDER BY attname`
  );
  say('coordinator types:', JSON.stringify(coord.rows));

  const shardTypes = await knex.raw(
    `SELECT DISTINCT result
       FROM run_command_on_shards(
         'bucket_usage',
         $$SELECT string_agg(attname || '=' || format_type(atttypid, atttypmod), ',' ORDER BY attname)
             FROM pg_attribute
            WHERE attrelid = '%s'::regclass
              AND attname IN ('minutes_used','overage_minutes')$$
       )`
  );
  say('shard types:', JSON.stringify(shardTypes.rows));
  process.exitCode = 0;
} catch (err) {
  console.error('REPLAY FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await knex.destroy();
}
