#!/usr/bin/env node
/**
 * One-off helper: run the EE onboarding seeds (roles, permissions, role_permissions)
 * for a single existing tenant. Use when a tenant was created via a path that did
 * not run the Temporal `run_onboarding_seeds` activity.
 *
 * Usage:
 *   node scripts/seed-tenant-onboarding.cjs <tenantId>
 */

const path = require('path');

const tenantId = process.argv[2];
if (!tenantId) {
  console.error('Usage: node scripts/seed-tenant-onboarding.cjs <tenantId>');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');

const knex = require(path.join(repoRoot, 'node_modules/knex'))({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT_DIRECT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: process.env.DB_PASSWORD_ADMIN || 'postpass123',
    database: process.env.DB_NAME_SERVER || 'server',
  },
});

const seedFiles = [
  'ee/server/seeds/onboarding/01_roles.cjs',
  'ee/server/seeds/onboarding/02_permissions.cjs',
  'ee/server/seeds/onboarding/03_role_permissions.cjs',
];

(async () => {
  try {
    for (const rel of seedFiles) {
      const seed = require(path.join(repoRoot, rel));
      console.log(`\n>>> Running ${rel} for tenant ${tenantId}`);
      await seed.seed(knex, tenantId);
    }
    console.log('\nDone.');
  } catch (err) {
    console.error('Seed run failed:', err);
    process.exitCode = 1;
  } finally {
    await knex.destroy();
  }
})();
