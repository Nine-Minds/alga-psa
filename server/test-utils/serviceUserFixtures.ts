import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Test fixtures for a non-interactive ('service') user.
 *
 * The CE schema rejects users.user_type = 'service'; only the EE migration
 * (F001) widens users_user_type_check. Tests that need a service user therefore
 * apply that migration to the test database first. It is idempotent.
 */
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const F001_MIGRATION = path.resolve(
  here,
  '../../ee/server/migrations/20261018090000_widen_users_user_type_check_for_service.cjs'
);

export async function allowServiceUserType(db: Knex): Promise<void> {
  const migration = require(F001_MIGRATION) as { up: (k: Knex) => Promise<void> };
  await migration.up(db);
}

export interface ServiceUserFixture {
  userId: string;
  tenant: string;
}

/** Insert a non-interactive user with a REAL valid password hash (proves gates don't rely on a locked password). */
export async function createServiceUser(
  db: Knex,
  tenant: string,
  overrides: { hashedPassword?: string; isInactive?: boolean } = {}
): Promise<ServiceUserFixture> {
  await allowServiceUserType(db);
  const userId = uuidv4();
  await db('users').insert({
    tenant,
    user_id: userId,
    username: `svc-${userId.slice(0, 8)}`,
    email: `svc-${userId.slice(0, 8)}@service.test`,
    first_name: 'Service',
    last_name: 'Principal',
    // Not the locked sentinel on purpose.
    hashed_password: overrides.hashedPassword ?? '$2a$10$abcdefghijklmnopqrstuuMkO3b0m8mP2S9y8m2Zr8Zq4G5vM3n8e',
    user_type: 'service',
    is_inactive: overrides.isInactive ?? false,
  });
  return { userId, tenant };
}
