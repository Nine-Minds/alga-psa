// Records every SQL statement issued by any knex pg client in this process, in order.
// Patching the dialect's _query (not a per-instance 'query' listener) covers every
// pool a code path opens (admin connection, tenant connection, transactions).
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

export function normalizeStatement(sql) {
  return String(sql)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(select|from|where|and|or|insert|into|update|delete|set|join|left|inner|on|order|by|group|limit|returning|values|as|not|null|in|exists|is|distinct)\b/gi, (k) => k.toLowerCase())
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '?');
}

export function startRecording() {
  const Client = require('knex/lib/dialects/postgres');
  const original = Client.prototype._query;
  const statements = [];
  Client.prototype._query = function patched(connection, obj) {
    const sql = typeof obj === 'string' ? obj : obj?.sql;
    // Session/pool housekeeping is not application SQL.
    if (sql && !/^\s*(set\s+(session|search_path|time zone|application_name)|select\s+version\(\)|select 1\b)/i.test(sql)) {
      statements.push({ sql: normalizeStatement(sql), bindings: Array.isArray(obj?.bindings) ? obj.bindings.length : 0 });
    }
    return original.call(this, connection, obj);
  };
  return {
    statements,
    mark: () => statements.length,
    since: (i) => statements.slice(i),
    stop: () => { Client.prototype._query = original; },
  };
}

export function emitStep(step, statements) {
  const out = process.env.HOTPATH_OUT;
  if (!out) return;
  const file = `${out}.${step}.json`;
  fs.writeFileSync(file, JSON.stringify({ step, count: statements.length, statements }, null, 1));
}
