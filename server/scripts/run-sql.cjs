#!/usr/bin/env node

const knex = require('knex');
const config = require('../knexfile.cjs');

async function runSQL() {
  const env = process.argv[2] || 'migration';
  const sql = process.argv[3];
  const params = process.argv.slice(4);

  if (!sql) {
    console.error('Usage: node run-sql.js [env] "SQL" [param1] [param2] ...');
    process.exit(1);
  }

  const db = knex(config[env] || config.development);

  try {
    const result = await db.raw(sql, params);
    console.log(JSON.stringify(result.rows || result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

runSQL();