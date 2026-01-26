const { Client } = require('pg');

function getDefaultConnectionString() {
  return process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING || '';
}

async function createDbClient({ connectionString, debug = false } = {}) {
  const conn = connectionString ?? getDefaultConnectionString();
  if (!conn) {
    throw new Error('Missing Postgres connection string. Set DATABASE_URL (or pass --pg-url).');
  }

  const client = new Client({ connectionString: conn });
  await client.connect();

  // Best-effort safety: prevent accidental writes from fixture assertions.
  try {
    await client.query('SET default_transaction_read_only = on');
  } catch {
    // ignore; some setups may not allow changing session settings
  }

  async function query(text, params) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.error('[db] query', text);
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

