// Smoke-test only (not for commit): the combined CE+EE migration directory —
// same merge recipe as setup/entrypoint.sh and the CI workflows — pointed at the
// running dev stack's database on port 5472. Credentials are read from the repo
// secrets files exactly the way knexfile.cjs's getSecret does.
// disableMigrationsListValidation is on because this dev database was migrated
// from a sibling branch that carries migrations absent from this branch.
const fs = require('fs');
const path = require('path');

const adminPassword = fs
  .readFileSync(path.join(__dirname, '..', 'secrets', 'postgres_password'), 'utf8')
  .trim();

module.exports = {
  migration: {
    client: 'pg',
    connection: {
      host: 'localhost',
      port: 5472,
      user: 'postgres',
      password: adminPassword,
      database: 'server',
    },
    pool: { min: 1, max: 5 },
    migrations: {
      directory: './combined-migrations',
      loadExtensions: ['.cjs'],
      disableMigrationsListValidation: true,
    },
  },
};
