function getDefaultConnectionString() {
  return process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING || '';
}

function isProbablyWriteQuery(text) {
  const trimmed = String(text ?? '').trim().toLowerCase();
  if (!trimmed) return false;
  // Keep this intentionally conservative (fast guardrail, not a SQL parser).
  return /^(insert|update|delete|create|drop|alter|truncate|grant|revoke)\b/.test(trimmed);
}

async function createDbClient({ connectionString, debug = false, readOnly = true } = {}) {
  let Client;
  try {
    // eslint-disable-next-line global-require
    ({ Client } = require('pg'));
  } catch (err) {
    const e = new Error('Missing dependency: "pg". Install workspace dependencies (e.g. `npm ci`) to use DB assertions.');
    e.cause = err;
    throw e;
  }

  const conn = connectionString ?? getDefaultConnectionString();
  if (!conn) {
    throw new Error('Missing Postgres connection string. Set DATABASE_URL (or pass --pg-url).');
  }

  const client = new Client({ connectionString: conn });
  await client.connect();

  async function query(text, params) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.error('[db] query', text);
    }
    if (readOnly && isProbablyWriteQuery(text)) {
      throw new Error('Refusing to execute write query in read-only DB client');
    }
    const res = await client.query(text, params);
    return res.rows;
  }

  async function close() {
    await client.end();
  }

  return { query, close };
}

module.exports = {
  createDbClient
};
