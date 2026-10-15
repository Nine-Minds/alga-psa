import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Explicit fixture setup, never part of application startup. Reuse the persisted
// credential across production and development server restarts.
export async function provisionBrowserCredential({ db, password, hashPassword, verifyPassword }) {
  if (!password) throw new Error('Credential required');
  return db.transaction(async trx => {
    const users = await trx('users').where({ email: 'glinda@emeraldcity.oz', user_type: 'internal', is_inactive: false })
      .select('user_id', 'tenant', 'hashed_password').limit(2).forUpdate();
    if (users.length !== 1) throw new Error('Seeded account missing or ambiguous');
    const user = users[0];
    if (await verifyPassword(password, user.hashed_password)) return;
    // A fresh fixture is empty. Never rotate an established account implicitly.
    if (user.hashed_password) throw new Error('Seeded account already has a different credential');
    const hash = await hashPassword(password);
    if (!await verifyPassword(password, hash)) throw new Error('Credential verification failed');
    const updated = await trx('users').where({ user_id: user.user_id, tenant: user.tenant }).update({ hashed_password: hash });
    if (updated !== 1) throw new Error('Seeded account update failed');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let db;
  const reportError = console.error.bind(console);
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};
  try {
    if (process.env.E2E_DATABASE_ISOLATED !== 'true') throw new Error('Isolated fixture required');
    const { default: knex } = await import('knex');
    const { getSecret } = await import('/app/packages/core/dist/lib/secrets/index.js');
    const { hashPassword, verifyPassword } = await import('/app/packages/core/dist/lib/encryption.js');
    db = knex({ client: 'pg', connection: {
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME_SERVER,
      user: process.env.DB_USER_SERVER, password: await getSecret('db_password_server', 'DB_PASSWORD_SERVER'),
    }, pool: { min: 0, max: 1 }, acquireConnectionTimeout: 15000 });
    await provisionBrowserCredential({ db, password: readFileSync(0, 'utf8'), hashPassword, verifyPassword });
  } catch {
    reportError('Browser fixture credential provisioning failed');
    process.exitCode = 1;
  } finally { await db?.destroy(); }
}
