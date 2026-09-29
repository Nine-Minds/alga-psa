import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { UserService } from '../../../../../packages/users/src/services/UserService';
import { hashPassword, verifyPassword } from '@alga-psa/core/encryption';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestUserWithPermissions } from '../../e2e/utils/e2eTestSetup';
import { handleApiError } from '../../../lib/api/middleware/apiMiddleware';

vi.mock('@alga-psa/core/secrets', async (original) => ({
  ...await original<typeof import('@alga-psa/core/secrets')>(),
  getSecret: async (_name: string, env: string, fallback = '') => process.env[env] ?? fallback,
}));

let db: Knex;
let trx: Knex.Transaction;
let tenant: string;
let service: UserService;
let targetId: string;
let originalHash: string;
const currentPassword = 'ExistingPassword123!';
const newPassword = 'ReplacementPassword456!';

beforeAll(async () => {
  vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-password-regression-secret');
  db = await createTestDbConnection();
  tenant = (await db('tenants').first<{ tenant: string }>('tenant'))!.tenant;
  originalHash = await hashPassword(currentPassword);
});
beforeEach(async () => {
  trx = await db.transaction();
  targetId = await createTestUserWithPermissions(trx, tenant, []);
  await trx('users').where({ tenant, user_id: targetId }).update({ hashed_password: originalHash });
  service = new UserService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: trx, tenant });
});
afterEach(async () => { await trx?.rollback(); vi.restoreAllMocks(); });
afterAll(async () => { await db?.destroy(); vi.unstubAllEnvs(); });

async function context(userId: string) {
  return { tenant, userId, user: await trx('users').where({ tenant, user_id: userId }).first() };
}
async function storedPassword() {
  return (await trx('users').where({ tenant, user_id: targetId }).first('hashed_password')).hashed_password;
}
async function expectRejected(operation: Promise<unknown>, status: number, code: string, message: string) {
  const error = await operation.then(() => { throw new Error('Expected password change to be denied'); }, error => error);
  const response = handleApiError(error);
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code, message } });
  expect(await storedPassword()).toBe(originalHash);
}

it.each([{ grants: [] }, { grants: ['user:update'] }])('returns 403 without changing another user password for grants $grants', async ({ grants }) => {
  const caller = await createTestUserWithPermissions(trx, tenant, grants);
  await expectRejected(service.changePassword({ user_id: targetId, new_password: newPassword }, await context(caller)),
    403, 'FORBIDDEN', grants.length ? "Only administrators can change other users' passwords" : 'Permission denied: Cannot update user');
});

it.each([undefined, 'WrongPassword123!'])('returns 400 for invalid current password %s and preserves the stored hash', async (password) => {
  await expectRejected(service.changePassword({ current_password: password, new_password: newPassword }, await context(targetId)),
    400, 'VALIDATION_ERROR', password ? 'Current password is incorrect' : 'Current password is required');
});

it('returns 404 for a missing tenant-scoped target', async () => {
  const caller = await createTestUserWithPermissions(trx, tenant, ['user:update']);
  await expectRejected(service.changePassword({ user_id: randomUUID(), new_password: newPassword }, await context(caller)),
    404, 'NOT_FOUND', 'User not found');
});

it('changes the callers own password without user-management grants and verifies the persisted replacement', async () => {
  expect(await service.changePassword({ current_password: currentPassword, new_password: newPassword }, await context(targetId)))
    .toMatchObject({ success: true });
  const replacement = await storedPassword();
  expect(replacement).not.toBe(originalHash);
  expect(await verifyPassword(newPassword, replacement)).toBe(true);
  expect(await verifyPassword(currentPassword, replacement)).toBe(false);
});
