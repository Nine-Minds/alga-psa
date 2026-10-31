/**
 * Service principals (card C / F087, F088; PRD R9.2, R9.3, R9.4).
 *
 * Data migration, ordered after 20261018100000_create_service_principals_schema.
 * For every `agents` row whose backing user still exists:
 *   - users.user_type      -> 'service'
 *   - users.is_inactive    -> NOT agents.active   (fixes existing drift)
 *   - users.first_name     -> agent name
 *   - agents.service_user_id backfilled from metadata.backing_user_id
 *   - service_principals row inserted (kind 'mcp_agent')
 *
 * Idempotent: an agent that already has a service_principals row is left alone,
 * so a rerun changes nothing (and never overrides later admin changes).
 * A backing user that is missing, or neither 'internal' nor 'service', is skipped
 * and logged.
 *
 * It NEVER deactivates or deletes anything to fit the Pro tier gate or the
 * principal limit (R6.0a, R9.3): over-limit and non-Pro tenants keep every agent
 * working; only creation of new principals is blocked by the service.
 *
 * R9.4: historical rows that point at a former agent user (assignee, schedule
 * resource, time owner) are left alone. Pre-flight count query: see the
 * "Commands / Runbooks" section of the plan SCRATCHPAD.
 *
 * This ships with the EE API boundary (R4.6); shipping one half alone breaks MCP
 * dispatch because assertInternalApiUser would reject the converted users.
 */
exports.config = { transaction: false };

const log = (message) => console.log(`[migrate_agent_users_to_service] ${message}`);

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('agents')) || !(await knex.schema.hasTable('service_principals'))) {
    log('agents or service_principals table missing; nothing to do');
    return;
  }

  // agents.tenant is varchar in the base MCP schema; users.tenant is uuid.
  const agents = await knex('agents').select(
    'agent_id',
    'tenant',
    'name',
    'description',
    'active',
    'created_by',
    'metadata',
    'service_user_id'
  );

  let converted = 0;
  let skipped = 0;
  for (const agent of agents) {
    const metadata =
      typeof agent.metadata === 'string' ? safeParse(agent.metadata) : agent.metadata || {};
    const userId = agent.service_user_id || metadata.backing_user_id;
    if (!userId) {
      log(`skip agent ${agent.agent_id} (tenant ${agent.tenant}): no backing user recorded`);
      skipped += 1;
      continue;
    }

    await knex.transaction(async (trx) => {
      const alreadyMigrated = await trx('service_principals')
        .where({ tenant: agent.tenant, user_id: userId })
        .first('user_id');
      if (alreadyMigrated) return;

      const user = await trx('users').where({ tenant: agent.tenant, user_id: userId }).first('user_id', 'user_type');
      if (!user) {
        log(`skip agent ${agent.agent_id} (tenant ${agent.tenant}): backing user ${userId} is missing`);
        skipped += 1;
        return;
      }
      if (user.user_type !== 'internal' && user.user_type !== 'service') {
        log(
          `skip agent ${agent.agent_id} (tenant ${agent.tenant}): backing user ${userId} is '${user.user_type}', not internal`
        );
        skipped += 1;
        return;
      }

      await trx('users')
        .where({ tenant: agent.tenant, user_id: userId })
        .update({
          user_type: 'service',
          is_inactive: !agent.active,
          first_name: agent.name,
        });
      await trx('agents')
        .where({ tenant: agent.tenant, agent_id: agent.agent_id })
        .update({ service_user_id: userId });
      await trx('service_principals').insert({
        tenant: agent.tenant,
        user_id: userId,
        kind: 'mcp_agent',
        name: agent.name,
        description: agent.description ?? null,
        allow_act_as: false,
        created_by: agent.created_by ?? null,
      });
      converted += 1;
    });
  }
  log(`converted ${converted} agent user(s); skipped ${skipped}`);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('service_principals'))) return;
  // Restore the agent-backed users to seat-counting internal users and drop their
  // principal rows. API principals (kind 'api') are left for the schema rollback
  // to refuse.
  const rows = await knex('service_principals').where({ kind: 'mcp_agent' }).select('tenant', 'user_id');
  for (const { tenant, user_id: userId } of rows) {
    await knex.transaction(async (trx) => {
      await trx('users').where({ tenant, user_id: userId, user_type: 'service' }).update({ user_type: 'internal' });
      await trx('service_principals').where({ tenant, user_id: userId }).del();
    });
  }
};

function safeParse(text) {
  try {
    return JSON.parse(text) || {};
  } catch {
    return {};
  }
}
