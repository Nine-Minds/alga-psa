// CM L6a1: extend main's time_tracking_sessions (20261009120000). Never a
// second timer table. Every column is nullable with no default and no trigger:
// N-1 code that writes sessions without these columns keeps working during
// blue/green.
const COLUMNS = [
  ['work_date', (t) => t.date('work_date').nullable()],
  ['work_timezone', (t) => t.text('work_timezone').nullable()],
  ['billing_mode', (t) => t.text('billing_mode').nullable()],
  ['completed_entry_id', (t) => t.uuid('completed_entry_id').nullable()],
  ['stopped_at', (t) => t.timestamp('stopped_at', { useTz: true }).nullable()],
  ['stop_request_hash', (t) => t.text('stop_request_hash').nullable()],
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('time_tracking_sessions'))) return;
  for (const [name, add] of COLUMNS) {
    if (!(await knex.schema.hasColumn('time_tracking_sessions', name))) {
      await knex.schema.alterTable('time_tracking_sessions', add);
    }
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('time_tracking_sessions'))) return;
  for (const [name] of [...COLUMNS].reverse()) {
    if (await knex.schema.hasColumn('time_tracking_sessions', name)) {
      await knex.schema.alterTable('time_tracking_sessions', (t) => t.dropColumn(name));
    }
  }
};
