/** Preserve the effective published advanced-visibility policy as a live audience. */
function convert(config) {
  if (config?.allowAll === false) return { join: 'or', clauses: [] };
  const valid = (value) => Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id.trim()) : [];
  const clients = valid(config?.allowedClientIds);
  const users = valid(config?.allowedRequesterUserIds);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const clauses = [];
  // Non-UUID strings could never equal a real ID. Keep an empty `in` clause when
  // all entries are invalid so an old deny-all list does not become unrestricted.
  if (clients.length) clauses.push({ path: 'client.id', operator: 'in', value: clients.filter((id) => uuid.test(id)) });
  if (users.length) clauses.push({ path: 'user.id', operator: 'in', value: users.filter((id) => uuid.test(id)) });
  return { join: 'and', clauses };
}

exports.convert = convert;
exports.up = async function up(knex) {
  while (true) {
    const definitions = await knex('service_request_definitions as d')
      .where('d.visibility_provider', 'advanced-visibility')
      .orWhereExists(knex('service_request_definition_versions as v').select(knex.raw('1'))
        .whereRaw('v.tenant = d.tenant').whereRaw('v.definition_id = d.definition_id')
        .where('v.visibility_provider', 'advanced-visibility'))
      .select('d.tenant', 'd.definition_id', 'd.visibility_config', 'd.visibility_provider', 'd.audience')
      .limit(100);
    if (definitions.length === 0) break;
    for (const definition of definitions) {
      const version = await knex('service_request_definition_versions')
        .where({ tenant: definition.tenant, definition_id: definition.definition_id })
        .orderBy('version_number', 'desc').first('visibility_provider', 'visibility_config');
      const effectiveProvider = version ? version.visibility_provider : definition.visibility_provider;
      const restriction = effectiveProvider === 'advanced-visibility'
        ? convert(version ? version.visibility_config : definition.visibility_config)
        : { join: 'and', clauses: [] };
      const audience = effectiveProvider === 'advanced-visibility'
        ? { join: 'and', clauses: [definition.audience, restriction] }
        : definition.audience;
      const updates = { audience: JSON.stringify(audience) };
      if (definition.visibility_provider === 'advanced-visibility') {
        updates.visibility_provider = 'all-authenticated-client-users';
        updates.visibility_config = '{}';
      }
      await knex('service_request_definitions').where({ tenant: definition.tenant, definition_id: definition.definition_id }).update(updates);
      await knex('service_request_definition_versions').where({ tenant: definition.tenant, definition_id: definition.definition_id, visibility_provider: 'advanced-visibility' })
        .update({ visibility_provider: 'all-authenticated-client-users', visibility_config: '{}' });
    }
  }
};
exports.down = async function down() {
  throw new Error('Advanced visibility conversion cannot be reversed without losing audience changes');
};
