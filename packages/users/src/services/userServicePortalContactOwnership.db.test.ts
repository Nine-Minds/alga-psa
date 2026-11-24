/**
 * Real Postgres locks and rollback, through the API's UserService. Only auth,
 * seat admission and presentation/audit side effects are stubbed; ownership,
 * user/role writes and contact flag sync run their production implementations.
 * Uses an isolated schema and drops it afterwards; no application data is read.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDb } from '../../../../server/test-utils/requireDb';
import { USER_RESPONSE_FIELD_NAMES } from '@alga-psa/types';
import { checkClientPortalContactAvailability } from '@alga-psa/db';

vi.mock('@alga-psa/auth', () => ({ verifyAuthenticator: () => true }));
vi.mock('@alga-psa/core/encryption', () => ({ hashPassword: async () => 'test-hash', verifyPassword: () => true }));
vi.mock('../lib/internalUserLicenseGuard', () => ({
  admitInternalUserSeat: async () => ({ ok: true }),
  assertInternalUserSeatsWithinLimit: async () => undefined,
  isInternalUserLicenseLimitRejected: () => false,
}));

const { UserService } = await import('./UserService');
const describeDb = await describeWithDb();
const slot = path.basename(process.cwd()).match(/mc\d+$/)?.[0]
  ?? path.basename(path.resolve(__dirname, '../../../..')).match(/mc\d+$/)?.[0] ?? 'ci';
const schema = `portal_ownership_${randomUUID().replaceAll('-', '')}_${slot}`;
const tenant = 'tenant-a';
const otherTenant = 'tenant-b';
const context = (tenantId = tenant) => ({ tenant: tenantId, userId: 'actor', user: {} }) as any;

// Externally controlled gate: tests wait for a real SQL lock wait rather than
// relying on sleeps to guess whether two requests overlapped.
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describeDb('API portal contact ownership', () => {
  let db: Knex;
  let admin: Knex;
  let service: any;

  beforeAll(async () => {
    const connection = {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN || 'postgres',
      database: process.env.DB_NAME_SERVER || 'postgres',
      application_name: schema,
    };
    admin = knex({ client: 'pg', connection });
    await admin.schema.createSchema(schema);
    db = knex({ client: 'pg', connection, searchPath: [schema], pool: { min: 0, max: 8 } });
    await db.schema.createTable('contacts', (table) => {
      table.text('tenant');
      table.text('contact_name_id');
      table.boolean('is_client_admin').notNullable().defaultTo(false);
      table.timestamp('updated_at');
      table.primary(['tenant', 'contact_name_id']);
    });
    await db.schema.createTable('users', (table) => {
      for (const field of [...USER_RESPONSE_FIELD_NAMES, 'hashed_password']) {
        if (['two_factor_enabled', 'two_factor_required_new_device', 'is_google_user', 'is_inactive'].includes(field)) {
          table.boolean(field).defaultTo(false);
        } else table.text(field);
      }
      table.primary(['tenant', 'user_id']);
      table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
    });
    await db.schema.createTable('roles', (table) => {
      table.text('tenant'); table.text('role_id'); table.text('role_name');
      table.boolean('client'); table.boolean('msp');
      table.primary(['tenant', 'role_id']);
    });
    await db.schema.createTable('user_roles', (table) => {
      table.text('tenant'); table.text('user_id'); table.text('role_id');
      table.primary(['tenant', 'user_id', 'role_id']);
    });
  });

  afterAll(async () => {
    await db?.destroy();
    if (admin) {
      await admin.schema.dropSchemaIfExists(schema, true);
      await admin.destroy();
    }
  });

  beforeEach(async () => {
    await db('user_roles').del(); await db('users').del();
    await db('contacts').del(); await db('roles').del();
    for (const tenantId of [tenant, otherTenant]) {
      await db('contacts').insert(['contact-a', 'contact-b', 'free-contact'].map((id) => ({
        tenant: tenantId, contact_name_id: id, is_client_admin: true,
      })));
      await db('roles').insert([
        { tenant: tenantId, role_id: 'user-role', role_name: 'User', client: true, msp: false },
        { tenant: tenantId, role_id: 'admin-role', role_name: 'Admin', client: true, msp: false },
        { tenant: tenantId, role_id: 'msp-role', role_name: 'Admin', client: false, msp: true },
      ]);
    }
    service = new UserService();
    service.getKnex = async () => ({ knex: db });
    service.ensurePermission = vi.fn(async () => undefined);
    service.emailExistsInAnotherTenant = async () => false;
    service.createDefaultUserPreferences = async () => undefined;
    service.logUserActivity = async () => undefined;
    service.enhanceUsersWithDetails = async (users: unknown[]) => users;
  });

  const create = (suffix: string, contactId: string | null, tenantId = tenant, extra = {}) => service.create({
    username: suffix, email: `${suffix}@ownership.test`, password: 'test-password',
    user_type: 'client', contact_id: contactId, role_ids: ['user-role'], ...extra,
  }, context(tenantId));
  const snapshot = async () => ({
    users: await db('users').orderBy(['tenant', 'user_id']),
    roles: await db('user_roles').orderBy(['tenant', 'user_id', 'role_id']),
    contacts: await db('contacts').orderBy(['tenant', 'contact_name_id']),
  });
  const conflict = { statusCode: 409, code: 'CONFLICT', message: 'This contact already has a client portal user. Choose another contact.' };
  const owners = () => db('users').where({ tenant, contact_id: 'free-contact', user_type: 'client' });

  it('refuses a second portal user with a different email without changing any rows', async () => {
    await create('owner', 'contact-a', tenant, { role_ids: ['admin-role'] });
    const before = await snapshot();
    await expect(create('different-email', 'contact-a')).rejects.toMatchObject(conflict);
    expect(await snapshot()).toEqual(before);
  });

  it('refuses relinking onto an occupied contact without changing users, roles or flags', async () => {
    await create('owner', 'contact-a', tenant, { role_ids: ['admin-role'] });
    const mover = await create('mover', 'contact-b');
    const before = await snapshot();
    await expect(service.update(mover.user_id, { contact_id: 'contact-a' }, context())).rejects.toMatchObject(conflict);
    expect(await snapshot()).toEqual(before);
  });

  it('allows the current owner to keep its link, including a profile-only update', async () => {
    const owner = await create('owner', 'contact-a');
    await service.update(owner.user_id, { contact_id: 'contact-a', first_name: 'Alice' }, context());
    await service.update(owner.user_id, { last_name: 'Liddell' }, context());
    expect(await db('users').where({ tenant, user_id: owner.user_id }).first()).toMatchObject({ contact_id: 'contact-a', first_name: 'Alice', last_name: 'Liddell' });
    expect(await db('contacts').where({ tenant, contact_name_id: 'contact-a' }).first()).toMatchObject({ is_client_admin: false });
  });

  it('keeps ownership and locks tenant-scoped, even for identical contact IDs', async () => {
    await create('owner-a', 'contact-a', tenant, { role_ids: ['admin-role'] });
    await create('owner-b', 'contact-a', otherTenant);
    const holder = await db.transaction();
    try {
      await checkClientPortalContactAvailability(holder, tenant, 'free-contact');
      // Completes while the other tenant holds its lock on the same ID.
      await create('independent', 'free-contact', otherTenant);
    } finally { await holder.rollback(); }
    expect(await db('contacts').where({ tenant, contact_name_id: 'contact-a' }).first()).toMatchObject({ is_client_admin: true });
    expect(await db('contacts').where({ tenant: otherTenant, contact_name_id: 'contact-a' }).first()).toMatchObject({ is_client_admin: false });
  });

  it('rejects a missing or other-tenant-only contact', async () => {
    await db('contacts').where({ tenant, contact_name_id: 'free-contact' }).del();
    const before = await snapshot();
    await expect(create('outsider', 'free-contact')).rejects.toMatchObject({ statusCode: 404, message: 'Contact not found' });
    expect(await snapshot()).toEqual(before);
  });

  it('leaves internal-user contact behavior unchanged and allows an unlinked portal user', async () => {
    await create('portal', 'contact-a');
    await create('internal', 'contact-a', tenant, { user_type: 'internal', role_ids: ['msp-role'] });
    await create('unlinked', null);
    expect(await db('users').where({ tenant })).toHaveLength(3);
  });

  it('refuses conversion to client when the existing contact is occupied', async () => {
    await create('owner', 'contact-a');
    const internal = await create('internal', 'contact-a', tenant, { user_type: 'internal', role_ids: ['msp-role'], is_inactive: true });
    const before = await snapshot();
    await expect(service.update(internal.user_id, { user_type: 'client' }, context())).rejects.toMatchObject(conflict);
    expect(await snapshot()).toEqual(before);
  });

  // Park the winner after user+roles+flag were written but before commit. The
  // loser must actually wait on its contact lock, then see the committed owner.
  async function race(winner: () => Promise<any>, loser: () => Promise<any>) {
    const written = gate(); const release = gate();
    let first = true;
    service.logUserActivity = async () => {
      if (first) { first = false; written.resolve(); await release.promise; }
    };
    const winning = winner();
    await written.promise;
    const losing = loser().then((value) => ({ value }), (error) => ({ error }));
    try {
      await vi.waitFor(async () => {
        const { rows } = await admin.raw("SELECT pid FROM pg_stat_activity WHERE application_name = ? AND wait_event_type = 'Lock' AND query LIKE ?", [schema, '%contacts%for update%']);
        expect(rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 10 });
    } finally { release.resolve(); }
    const result = await winning;
    expect(await losing).toMatchObject({ error: conflict });
    expect(await owners()).toHaveLength(1);
    expect(await db('contacts').where({ tenant, contact_name_id: 'free-contact' }).first()).toMatchObject({ is_client_admin: false });
    return result;
  }

  it('serializes two concurrent creates; only the winner writes users and roles', async () => {
    await race(() => create('winner', 'free-contact'), () => create('loser', 'free-contact', tenant, { role_ids: ['admin-role'] }));
    expect(await db('users').where({ tenant })).toHaveLength(1);
    expect(await db('user_roles').where({ tenant })).toHaveLength(1);
  });

  it('serializes concurrent relinks and preserves the losing account and flag', async () => {
    const first = await create('first', 'contact-a');
    const second = await create('second', 'contact-b', tenant, { role_ids: ['admin-role'] });
    const before = await snapshot();
    await race(
      () => service.update(first.user_id, { contact_id: 'free-contact' }, context()),
      () => service.update(second.user_id, { contact_id: 'free-contact' }, context()),
    );
    const after = await snapshot();
    expect(after.users.find((row) => row.user_id === second.user_id)).toEqual(before.users.find((row) => row.user_id === second.user_id));
    expect(after.roles).toEqual(before.roles);
    expect(after.contacts.find((row) => row.tenant === tenant && row.contact_name_id === 'contact-b')).toEqual(before.contacts.find((row) => row.tenant === tenant && row.contact_name_id === 'contact-b'));
  });

  it('serializes a create racing a relink', async () => {
    const mover = await create('mover', 'contact-a');
    await race(
      () => service.update(mover.user_id, { contact_id: 'free-contact' }, context()),
      () => create('loser', 'free-contact'),
    );
    expect(await db('users').where({ tenant })).toHaveLength(1);
  });

  it('rejects a stale same-account update instead of combining an unchecked link and type', async () => {
    await create('owner', 'contact-b');
    const changing = await create('changing', 'contact-a', tenant, {
      user_type: 'internal', role_ids: ['msp-role'], is_inactive: true,
    });
    const written = gate(); const release = gate();
    service.logUserActivity = async () => { written.resolve(); await release.promise; };
    const winner = service.update(changing.user_id, { user_type: 'client' }, context());
    await written.promise;
    // The losing request still reads 'internal', so its contact is not checked.
    // It must not apply that link after the winner changes the type to client.
    const loser = service.update(changing.user_id, { contact_id: 'contact-b' }, context())
      .then((value: unknown) => ({ value }), (error: unknown) => ({ error }));
    try {
      await vi.waitFor(async () => {
        const { rows } = await admin.raw("SELECT pid FROM pg_stat_activity WHERE application_name = ? AND wait_event_type = 'Lock' AND query LIKE ?", [schema, '%update "users"%']);
        expect(rows.length).toBeGreaterThan(0);
      }, { timeout: 3000, interval: 10 });
    } finally { release.resolve(); }
    await winner;
    expect(await loser).toMatchObject({ error: {
      statusCode: 409, code: 'CONFLICT',
      message: 'The user contact or type changed during this update. Please retry.',
    } });
    expect(await db('users').where({ tenant, user_id: changing.user_id }).first())
      .toMatchObject({ user_type: 'client', contact_id: 'contact-a' });
    expect(await db('users').where({ tenant, contact_id: 'contact-b', user_type: 'client' })).toHaveLength(1);
  });

  it('rolls back a relink and its flag sync when a later step fails', async () => {
    const mover = await create('mover', 'contact-a');
    const before = await snapshot();
    service.logUserActivity = async () => { throw new Error('audit failure'); };
    await expect(service.update(mover.user_id, { contact_id: 'free-contact' }, context())).rejects.toThrow('audit failure');
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back the link, roles and flag together if a later creation step fails', async () => {
    const before = await snapshot();
    service.logUserActivity = async () => { throw new Error('audit failure'); };
    await expect(create('failed', 'free-contact')).rejects.toThrow('audit failure');
    expect(await snapshot()).toEqual(before);
    service.logUserActivity = async () => undefined;
    await create('retry', 'free-contact');
  });
});
