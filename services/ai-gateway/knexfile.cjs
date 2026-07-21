const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config();

function readPassword() {
  if (process.env.AI_GATEWAY_DB_PASSWORD !== undefined) {
    return process.env.AI_GATEWAY_DB_PASSWORD;
  }

  const passwordFile = process.env.AI_GATEWAY_DB_PASSWORD_FILE;
  if (passwordFile && fs.existsSync(passwordFile)) {
    return fs.readFileSync(passwordFile, 'utf8').trim();
  }

  return '';
}

const connection = process.env.AI_GATEWAY_DATABASE_URL || {
  host: process.env.AI_GATEWAY_DB_HOST || '127.0.0.1',
  port: Number.parseInt(process.env.AI_GATEWAY_DB_PORT || '5432', 10),
  database: process.env.AI_GATEWAY_DB_NAME || 'ai_gateway',
  user: process.env.AI_GATEWAY_DB_USER || 'postgres',
  password: readPassword(),
};

module.exports = {
  client: 'pg',
  connection,
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    extension: 'cjs',
    tableName: 'knex_migrations',
  },
};
