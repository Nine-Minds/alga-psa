/**
 * A trusted agent IdP with no expected audience cannot be trusted: token
 * validation now refuses it (see ee/server/src/lib/mcp/idpToken.ts). Deactivate
 * legacy rows whose audience is NULL or blank so they are inert and visible for
 * repair. Rows are kept; no constraint is added (the invariant lives where
 * trust is decided, in application code).
 *
 * The write is batched: a keyset cursor over (tenant, id) reads at most
 * BATCH_SIZE matching rows at a time and each batch is deactivated inside its
 * own tenant, so no single statement touches an unbounded row set or fans out
 * across Citus shards.
 */

const TABLE = 'agent_idp_providers';
const BATCH_SIZE = 500;

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  let cursor;
  while (true) {
    const query = knex(TABLE)
      .select('tenant', 'id')
      .where({ active: true })
      .where((q) => q.whereNull('audience').orWhereRaw("btrim(audience) = ''"))
      .orderBy('tenant')
      .orderBy('id')
      .limit(BATCH_SIZE);
    if (cursor) query.whereRaw('(tenant, id) > (?, ?)', cursor);
    const rows = await query;
    if (!rows.length) break;

    const idsByTenant = new Map();
    for (const row of rows) {
      if (!idsByTenant.has(row.tenant)) idsByTenant.set(row.tenant, []);
      idsByTenant.get(row.tenant).push(row.id);
    }
    for (const [tenant, ids] of idsByTenant) {
      await knex(TABLE)
        .where({ tenant, active: true })
        .whereIn('id', ids)
        .update({ active: false, updated_at: knex.fn.now() });
    }

    const last = rows[rows.length - 1];
    cursor = [last.tenant, last.id];
  }
};

/**
 * No-op: re-activating would restore fail-open trust, and we cannot tell which
 * rows this migration deactivated versus an operator.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down() {};
