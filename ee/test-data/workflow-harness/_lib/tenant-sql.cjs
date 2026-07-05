function requireTenantId(ctx, tenantId) {
  const resolved = tenantId ?? ctx?.config?.tenantId;
  if (!resolved) {
    throw new Error('Workflow fixture tenant SQL requires ctx.config.tenantId or an explicit tenantId');
  }
  return resolved;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function tenantColumn(alias) {
  return alias ? `${alias}.tenant` : 'tenant';
}

function tenantWhere(alias, paramIndex = 1) {
  return `${tenantColumn(alias)} = $${paramIndex}`;
}

function tenantEquals(leftAlias, rightAlias) {
  return `${tenantColumn(leftAlias)} = ${tenantColumn(rightAlias)}`;
}

function tenantJoin(leftSource, rightSource, options = {}) {
  const { leftAlias, rightAlias, on, joinType = 'join' } = options;
  if (!leftSource || !rightSource || !leftAlias || !rightAlias) {
    throw new Error('tenantJoin requires leftSource, rightSource, leftAlias, and rightAlias');
  }

  const clauses = [tenantEquals(rightAlias, leftAlias), ...asArray(on)];
  return `${leftSource} ${joinType} ${rightSource} on ${clauses.join(' and ')}`;
}

function tenantParams(ctx, params = [], tenantId) {
  return [requireTenantId(ctx, tenantId), ...params];
}

function buildWhere({ tenantAlias, where }) {
  const clauses = [tenantWhere(tenantAlias), ...asArray(where)];
  return `where ${clauses.join('\n  and ')}`;
}

function appendClause(parts, keyword, value) {
  if (value) parts.push(`${keyword} ${value}`);
}

async function selectTenantRows(ctx, options) {
  const {
    table,
    from,
    columns = '*',
    tenantAlias,
    tenantId,
    where,
    params = [],
    orderBy,
    limit,
    write = false
  } = options;

  const source = from ?? table;
  if (!source) throw new Error('selectTenantRows requires table or from');

  const parts = [
    `select ${columns}`,
    `from ${source}`,
    buildWhere({ tenantAlias, where })
  ];
  appendClause(parts, 'order by', orderBy);
  if (limit !== undefined) appendClause(parts, 'limit', Number(limit) || 1);

  const client = write ? ctx.dbWrite : ctx.db;
  return client.query(parts.join('\n'), tenantParams(ctx, params, tenantId));
}

async function selectTenantOne(ctx, options) {
  const rows = await selectTenantRows(ctx, { ...options, limit: 1 });
  return rows[0] ?? null;
}

async function pickTenantOne(ctx, options) {
  const row = await selectTenantOne(ctx, options);
  if (!row) {
    const label = options.label ?? options.table ?? options.from ?? 'a tenant row';
    throw new Error(`Fixture requires ${label} in DB (tenant=${requireTenantId(ctx, options.tenantId)}).`);
  }
  return row;
}

async function deleteTenantRows(ctx, options) {
  const { table, tenantAlias, tenantId, where, params = [] } = options;
  if (!table) throw new Error('deleteTenantRows requires table');

  const sql = [
    `delete from ${table}`,
    buildWhere({ tenantAlias, where })
  ].join('\n');

  return ctx.dbWrite.query(sql, tenantParams(ctx, params, tenantId));
}

async function updateTenantRows(ctx, options) {
  const { table, set, tenantAlias, tenantId, where, params = [], returning } = options;
  if (!table) throw new Error('updateTenantRows requires table');
  if (!set) throw new Error('updateTenantRows requires set');

  const parts = [
    `update ${table}`,
    `set ${set}`,
    buildWhere({ tenantAlias, where })
  ];
  appendClause(parts, 'returning', returning);

  return ctx.dbWrite.query(parts.join('\n'), tenantParams(ctx, params, tenantId));
}

async function insertTenantRow(ctx, options) {
  const { table, tenantId, columns = [], values = [], params = [], returning } = options;
  if (!table) throw new Error('insertTenantRow requires table');
  if (columns.length !== values.length) {
    throw new Error('insertTenantRow requires matching columns and values');
  }

  const parts = [
    `insert into ${table} (tenant${columns.length ? `, ${columns.join(', ')}` : ''})`,
    `values ($1${values.length ? `, ${values.join(', ')}` : ''})`
  ];
  appendClause(parts, 'returning', returning);

  return ctx.dbWrite.query(parts.join('\n'), tenantParams(ctx, params, tenantId));
}

module.exports = {
  deleteTenantRows,
  insertTenantRow,
  pickTenantOne,
  selectTenantOne,
  selectTenantRows,
  tenantEquals,
  tenantJoin,
  tenantParams,
  tenantWhere,
  updateTenantRows
};
