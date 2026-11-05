const hooks = new WeakMap();
const auditRows = [];
const controlledMessages = [];
const tenantId = '11111111-1111-4111-8111-111111111111';
const ticketId = '22222222-2222-4222-8222-222222222222';
const manager = {
  manager_user_id: '33333333-3333-4333-8333-333333333333',
  manager_email: 'sla-manager@example.test',
  manager_first_name: 'SLA',
  manager_last_name: 'Manager',
  notify_via: ['email'],
};
const threshold = {
  threshold_id: '55555555-5555-4555-8555-555555555555',
  threshold_percent: 50,
  notification_type: 'warning',
  notify_assignee: true,
  notify_board_manager: false,
  notify_escalation_manager: false,
  channels: ['email'],
};
const ticket = {
  ticket_id: ticketId,
  ticket_number: 'BUILD-222',
  title: 'Built worker escalation',
  board_id: '44444444-4444-4444-8444-444444444444',
  assigned_to: null,
  escalation_level: 0,
  escalated: false,
};

class Query {
  constructor(table, connection) {
    this.table = table.split(/\s+as\s+/i)[0];
    this.connection = connection;
    this.filters = [];
  }
  where(...args) { this.filters.push(args); return this; }
  whereIn(...args) { this.filters.push(args); return this; }
  select() { return this; }
  tenantJoin() { return this; }
  leftJoin() { return this; }
  join() { return this; }
  async first() {
    if (this.table === 'tickets') return { ...ticket };
    if (this.table === 'escalation_managers') return { ...manager };
    if (this.table === 'sla_notification_thresholds') return { ...threshold };
    if (this.table === 'sla_policies') return { policy_name: 'Build fixture policy' };
    if (this.table === 'boards') return { manager_user_id: manager.manager_user_id };
    if (this.table === 'users') return { user_id: manager.manager_user_id, email: manager.manager_email, first_name: 'SLA', last_name: 'Manager' };
    if (this.table === 'notification_subtypes') return { id: 71, category_id: 9 };
    if (this.table === 'sla_audit_log') {
      const logId = this.filters.flatMap((filter) => typeof filter[0] === 'object' ? [filter[0].log_id] : []).find(Boolean);
      const row = auditRows.find((item) => item.log_id === logId);
      return row ? { event_data: row.event_data } : null;
    }
    return null;
  }
  orderBy() { return this; }
  async insert(value) {
    if (this.table === 'sla_audit_log') {
      for (const item of Array.isArray(value) ? value : [value]) auditRows.push({ ...item });
    }
    return [];
  }
  async update(value) {
    if (this.table === 'sla_audit_log') {
      const logId = this.filters.flatMap((filter) => typeof filter[0] === 'object' ? [filter[0].log_id] : []).find(Boolean);
      const row = auditRows.find((item) => item.log_id === logId);
      if (row) Object.assign(row, value);
    }
    return 1;
  }
  then(resolve, reject) {
    const rows = this.table === 'escalation_managers' ? [{
      user_id: manager.manager_user_id,
      email: manager.manager_email,
      first_name: manager.manager_first_name,
      last_name: manager.manager_last_name,
    }] : [];
    return Promise.resolve(rows).then(resolve, reject);
  }
}

const fakeKnex = (table) => new Query(table, fakeKnex);
fakeKnex.fn = { now: () => new Date('2026-11-01T00:00:00.000Z') };
fakeKnex.raw = () => ({ toSQL: () => ({ sql: '?', bindings: [] }) });

export function tenantDb(_connection, _tenant) {
  return {
    table: (table) => new Query(table, fakeKnex),
    unscoped: (table) => new Query(table, fakeKnex),
    tenantJoin: (query) => query,
  };
}

export function registerAfterCommitWithConnection(trx, callback) {
  const entries = hooks.get(trx) || [];
  entries.push(callback);
  hooks.set(trx, entries);
}

export function registerAfterCommit(trx, callback) {
  const entries = hooks.get(trx) || [];
  entries.push(() => callback());
  hooks.set(trx, entries);
}

export async function flushBuildHooks(trx) {
  const entries = hooks.get(trx) || [];
  hooks.delete(trx);
  for (const callback of entries) await callback(fakeKnex);
}

export async function withTenantTransaction() { throw new Error('unexpected activity transaction in build guard'); }
export async function withTenantTransactionRetryReadOnly() { throw new Error('unexpected activity transaction in build guard'); }
export async function withTransaction() { throw new Error('unexpected in-app notification transaction in build guard'); }
export async function createTenantKnex() { return { knex: fakeKnex }; }
export async function getConnection() { return fakeKnex; }

export const buildFixture = {
  tenantId,
  ticketId,
  manager,
  ticket,
  auditRows,
  controlledMessages,
  fakeKnex,
};
