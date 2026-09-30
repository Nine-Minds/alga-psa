import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
import { provisionBrowserCredential } from '../../e2e-tests/harness/provision-browser-credential.mjs';

const unregister = register();
after(unregister);
Object.assign(process.env, { SECRET_READ_CHAIN: 'env', SECRET_WRITE_PROVIDER: 'filesystem', nextauth_secret: 'synthetic-browser-fixture-key' });
const { hashPassword, verifyPassword } = await import('../../packages/core/src/lib/encryption.ts');
const password = 'synthetic-browser-password';
function fixture(rows) {
  let writes = 0;
  const trx = table => {
    assert.equal(table, 'users');
    let criteria;
    return {
      where(value) { criteria = value; return this; },
      select() { return this; }, limit(count) { assert.equal(count, 2); return this; },
      async forUpdate() {
        assert.deepEqual(criteria, { email: 'glinda@emeraldcity.oz', user_type: 'internal', is_inactive: false });
        return rows;
      },
      async update(value) {
        assert.deepEqual(criteria, { user_id: 'seeded-user', tenant: 'seeded-tenant' });
        writes++; Object.assign(rows[0], value); return 1;
      },
    };
  };
  return { db: { transaction: fn => fn(trx) }, writes: () => writes };
}
const user = hash => ({ user_id: 'seeded-user', tenant: 'seeded-tenant', hashed_password: hash });
test('fresh production fixture authenticates and the same credential survives server restart setup', async () => {
  const rows = [user('')];
  // This is the persisted dev-seed value used by the production browser lane.
  assert.equal(await verifyPassword(password, rows[0].hashed_password), false);
  const f = fixture(rows);
  await provisionBrowserCredential({ ...f, password, hashPassword, verifyPassword });
  assert.equal(await verifyPassword(password, rows[0].hashed_password), true);
  const persisted = rows[0].hashed_password;
  await provisionBrowserCredential({ ...f, password, hashPassword, verifyPassword });
  assert.equal(rows[0].hashed_password, persisted);
  assert.equal(f.writes(), 1);
});
test('an established password is preserved when a different password is requested', async () => {
  const hash = await hashPassword('existing-password');
  const rows = [user(hash)];
  const f = fixture(rows);
  await assert.rejects(provisionBrowserCredential({ ...f, password, hashPassword, verifyPassword }), /different credential/);
  assert.equal(f.writes(), 0);
  assert.equal(await verifyPassword('existing-password', rows[0].hashed_password), true);
});
test('missing and ambiguous accounts cannot be provisioned', async () => {
  for (const rows of [[], [user(''), user('')]]) {
    const f = fixture(rows);
    await assert.rejects(provisionBrowserCredential({ ...f, password, hashPassword, verifyPassword }), /missing or ambiguous/);
    assert.equal(f.writes(), 0);
  }
});
test('failed password verification leaves the fixture untouched', async () => {
  const f = fixture([user('')]);
  await assert.rejects(provisionBrowserCredential({ ...f, password, hashPassword, verifyPassword: async () => false }), /verification failed/);
  assert.equal(f.writes(), 0);
});
