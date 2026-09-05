import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestUser } from '../../helpers/notificationTestHelpers';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// Bootstraps the standard isolated test database (drop/recreate + migrate +
// seed) exactly like every other integration suite, so the Tier-1 gate can run
// this suite anywhere without a bespoke database. Per-worktree isolation is
// handled by TEST_DB_NAME as usual; verifyTestDatabase() blocks production names.
let testDb: Knex;
const auth = vi.hoisted(() => ({ user: null as any }));
vi.mock('../../../../../packages/auth/src/lib/getCurrentUser', () => ({
  getCurrentUserWithRevocationCheck: () => Promise.resolve(auth.user),
}));
vi.mock('../../../../../packages/auth/src/lib/localizeActionError', () => ({ localizeActionError: async (result: unknown) => result }));
vi.mock('@alga-psa/auth', async () => {
  const { withAuth } = await import('../../../../../packages/auth/src/lib/withAuth');
  return { withAuth, hasPermission: vi.fn(() => { throw new Error('Personal preferences must not request admin permission'); }) };
});
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: vi.fn(async () => ({ knex: testDb, tenant: auth.user?.tenant })),
  getConnection: vi.fn(async () => testDb),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: () => ({ sendEmail: mail.send }) },
  StaticTemplateProcessor: class { constructor(public subject: string, public html: string, public text: string) {} },
}));
vi.mock('../../../../../packages/notifications/src/notifications/emailLocaleResolver', () => ({ resolveEmailLocale: async () => 'en' }));

import * as actions from '../../../../../packages/notifications/src/actions/notification-actions/notificationActions';
import { isNotificationActionError } from '../../../../../packages/notifications/src/actions/notificationActionErrors';
import { EmailNotificationService } from '../../../../../packages/notifications/src/notifications/email';
import { createTenantKnex } from '@alga-psa/db';
import { revalidatePath } from 'next/cache';

const tenant = randomUUID(), otherTenant = randomUUID();
let userId: string, peerId: string, otherUserId: string;
let categoryId: number, disabledCategoryId: number, subtypeA: number, subtypeB: number, disabledSubtype: number, disabledCategorySubtype: number;
const rows = () => testDb('user_notification_preferences').where({ tenant, user_id: userId }).orderBy('subtype_id');
const state = async () => (await actions.getUserEmailPreferenceStateAction()).find(c => c.id === categoryId)!;

describe('authenticated personal email preferences with real database transactions', () => {
  beforeAll(async () => {
    testDb = await createTestDbConnection();
    await testDb.migrate.latest();
    await testDb('tenants').insert([tenant, otherTenant].map(tenant => ({ tenant, client_name: 'Synthetic Preferences', email: 'preferences@example.test' })));
    userId = (await createTestUser(testDb, tenant)).user_id;
    peerId = (await createTestUser(testDb, tenant)).user_id;
    otherUserId = (await createTestUser(testDb, otherTenant)).user_id;
    const category = async (name: string) => (await testDb('notification_categories').insert({ name: `${name}-${randomUUID()}` }).returning('id'))[0].id;
    categoryId = await category('Synthetic email');
    disabledCategoryId = await category('Disabled email');
    const subtype = async (category_id: number) => (await testDb('notification_subtypes').insert({ category_id, name: `synthetic-${randomUUID()}` }).returning('id'))[0].id;
    subtypeA = await subtype(categoryId); subtypeB = await subtype(categoryId);
    disabledSubtype = await subtype(categoryId); disabledCategorySubtype = await subtype(disabledCategoryId);
    await testDb('tenant_notification_subtype_settings').insert({ tenant, subtype_id: disabledSubtype, is_enabled: false, is_default_enabled: false });
    await testDb('tenant_notification_subtype_settings').insert({ tenant, subtype_id: subtypeB, is_enabled: true, is_default_enabled: false });
    await testDb('tenant_notification_category_settings').insert({ tenant, category_id: categoryId, is_enabled: true, is_default_enabled: false });
    await testDb('tenant_notification_category_settings').insert({ tenant, category_id: disabledCategoryId, is_enabled: false });
  });
  beforeEach(async () => {
    auth.user = { user_id: userId, tenant, user_type: 'internal', roles: [] };
    vi.mocked(revalidatePath).mockReset();
    await testDb('user_notification_preferences').whereIn('tenant', [tenant, otherTenant]).del();
    await testDb('notification_settings').where({ tenant }).del();
  });
  afterAll(async () => {
    if (!testDb) return;
    await testDb.raw('DROP TRIGGER IF EXISTS synthetic_preference_failure ON user_notification_preferences');
    await testDb.raw('DROP FUNCTION IF EXISTS synthetic_preference_failure()');
    for (const table of ['notification_logs', 'user_notification_preferences', 'notification_settings', 'tenant_notification_subtype_settings', 'tenant_notification_category_settings', 'users', 'tenants']) {
      await testDb(table).whereIn('tenant', [tenant, otherTenant]).del();
    }
    await testDb('notification_subtypes').whereIn('category_id', [categoryId, disabledCategoryId]).del();
    await testDb('notification_categories').whereIn('id', [categoryId, disabledCategoryId]).del();
    await testDb.destroy();
  });

  it('hydrates overrides and delivery defaults, with tenant restrictions and mixed eligible children', async () => {
    await testDb('user_notification_preferences').insert({ tenant, user_id: userId, subtype_id: subtypeA, is_enabled: false });
    const category = await state();
    expect(category.is_enabled).toBe(true);
    expect(category.subtypes.find(s => s.id === subtypeA)).toMatchObject({ has_user_override: true, effective_is_enabled: false });
    // is_default_enabled=false is an administrative default, not a delivery veto.
    expect(category.subtypes.find(s => s.id === subtypeB)).toMatchObject({ has_user_override: false, effective_is_enabled: true });
    expect(category.subtypes.find(s => s.id === disabledSubtype)?.effective_is_enabled).toBe(false);
    expect((await actions.getUserEmailPreferenceStateAction()).find(c => c.id === disabledCategoryId)?.is_enabled).toBe(false);
    expect(category.subtypes.filter(s => s.is_enabled).map(s => s.effective_is_enabled).sort()).toEqual([false, true]);
  });

  it('honors the tenant-wide gate without creating or changing tenant settings during reads', async () => {
    await state();
    expect(await testDb('notification_settings').where({ tenant })).toHaveLength(0);
    await testDb('notification_settings').insert({ tenant, is_enabled: false });
    const before = await testDb('notification_settings').where({ tenant });
    expect((await state()).is_enabled).toBe(false);
    expect((await state()).subtypes.every(s => !s.effective_is_enabled)).toBe(true);
    expect(isNotificationActionError(await actions.updateUserEmailCategoryPreferencesAction(categoryId, true))).toBe(true);
    expect(isNotificationActionError(await actions.updateUserEmailSubtypePreferenceAction(subtypeA, true))).toBe(true);
    expect(await rows()).toHaveLength(0);
    expect(await testDb('notification_settings').where({ tenant })).toEqual(before);
  });

  it('rejects unauthenticated reads and writes through the real withAuth wrapper', async () => {
    auth.user = null;
    for (const action of [() => actions.getUserEmailPreferenceStateAction(), () => actions.getUserPreferencesAction(),
      () => actions.updateUserEmailSubtypePreferenceAction(subtypeA, false), () => actions.updateUserEmailCategoryPreferencesAction(categoryId, false),
      () => actions.updateUserPreferenceAction(tenant, userId, { subtype_id: subtypeA, is_enabled: false })]) {
      await expect(action()).rejects.toThrow('User not authenticated');
    }
    expect(await rows()).toHaveLength(0);
  });

  it('rejects spoofed users, tenants and identity fields in legacy payloads', async () => {
    for (const [callerTenant, callerUser] of [[tenant, peerId], [otherTenant, otherUserId], [otherTenant, userId]]) {
      await expect(actions.getUserPreferencesAction(callerTenant, callerUser)).rejects.toThrow('Cannot access');
      await expect(actions.updateUserPreferenceAction(callerTenant, callerUser, { subtype_id: subtypeA, is_enabled: false })).rejects.toThrow('Cannot access');
    }
    await expect(actions.updateUserPreferenceAction(tenant, userId, { subtype_id: subtypeA, is_enabled: false, tenant: otherTenant })).rejects.toThrow('Cannot access');
    await expect(actions.updateUserPreferenceAction(tenant, userId, { subtype_id: subtypeA, is_enabled: false, user_id: peerId })).rejects.toThrow('Cannot access');
    expect(await rows()).toHaveLength(0);
  });

  it('isolates same-tenant peers and other tenants on both hydration and mutations', async () => {
    await testDb('user_notification_preferences').insert([
      { tenant, user_id: peerId, subtype_id: subtypeA, is_enabled: false },
      { tenant: otherTenant, user_id: otherUserId, subtype_id: subtypeB, is_enabled: false },
    ]);
    expect((await state()).subtypes.find(s => s.id === subtypeA)?.effective_is_enabled).toBe(true);
    await actions.updateUserEmailCategoryPreferencesAction(categoryId, true);
    expect(await actions.getUserPreferencesAction(tenant, userId)).toHaveLength(2);
    expect((await testDb('user_notification_preferences').where({ tenant, user_id: peerId }).first()).is_enabled).toBe(false);
    expect((await testDb('user_notification_preferences').where({ tenant: otherTenant, user_id: otherUserId }).first()).is_enabled).toBe(false);
    auth.user = { user_id: otherUserId, tenant: otherTenant, user_type: 'client', roles: [] };
    expect((await state()).subtypes.find(s => s.id === disabledSubtype)?.is_enabled).toBe(true);
  });

  it('persists subtype off/on without duplicates or administrative permissions, including the legacy action', async () => {
    const settings = async () => Promise.all(['notification_settings', 'tenant_notification_category_settings', 'tenant_notification_subtype_settings'].map(table => testDb(table).where({ tenant })));
    const before = await settings();
    await actions.updateUserEmailSubtypePreferenceAction(subtypeA, false);
    expect((await state()).subtypes.find(s => s.id === subtypeA)?.effective_is_enabled).toBe(false);
    await actions.updateUserPreferenceAction(tenant, userId, { subtype_id: subtypeA, is_enabled: true });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0].is_enabled).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/msp/profile');
    expect(revalidatePath).toHaveBeenCalledWith('/client-portal/profile');
    expect(await settings()).toEqual(before);
  });

  it('validates IDs, booleans, missing subtypes/categories, and disabled membership on every write path', async () => {
    for (const id of [0, -1, 1.5, NaN, '1']) await expect(actions.updateUserEmailSubtypePreferenceAction(id as number, true)).rejects.toThrow('Invalid email preference');
    await expect(actions.updateUserEmailCategoryPreferencesAction(categoryId, 'false' as any)).rejects.toThrow('Invalid email preference');
    for (const id of [2147483647, disabledSubtype, disabledCategorySubtype]) {
      expect(isNotificationActionError(await actions.updateUserEmailSubtypePreferenceAction(id, true))).toBe(true);
      await expect(actions.updateUserPreferenceAction(tenant, userId, { subtype_id: id, is_enabled: true })).rejects.toThrow();
    }
    expect(isNotificationActionError(await actions.updateUserEmailCategoryPreferencesAction(2147483647, false))).toBe(true);
    expect(isNotificationActionError(await actions.updateUserEmailCategoryPreferencesAction(disabledCategoryId, false))).toBe(true);
    expect(await rows()).toHaveLength(0);
  });

  it('bulk upserts exactly the eligible children on one connection and preserves disabled overrides', async () => {
    await testDb('user_notification_preferences').insert({ tenant, user_id: userId, subtype_id: disabledSubtype, is_enabled: true });
    const queries: { sql: string; connection: unknown }[] = [];
    const listener = (query: any) => queries.push({ sql: query.sql, connection: query.__knexUid });
    testDb.on('query', listener);
    try { await actions.updateUserEmailCategoryPreferencesAction(categoryId, false); } finally { testDb.off('query', listener); }
    expect(queries.filter(q => q.sql.startsWith('insert into "user_notification_preferences"'))).toHaveLength(1);
    expect(new Set(queries.map(q => q.connection)).size).toBe(1);
    expect((await rows()).filter(r => r.subtype_id !== disabledSubtype).every(r => !r.is_enabled)).toBe(true);
    expect((await rows()).find(r => r.subtype_id === disabledSubtype).is_enabled).toBe(true);
    await actions.updateUserEmailCategoryPreferencesAction(categoryId, true);
    expect(await rows()).toHaveLength(3);
  });

  it.each(['statement', 'commit'])('rolls back a database failure at %s and retries without duplicates', async failurePoint => {
    await actions.updateUserEmailSubtypePreferenceAction(subtypeA, true);
    await testDb.raw(`CREATE FUNCTION synthetic_preference_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.subtype_id = ${subtypeB} THEN RAISE EXCEPTION 'synthetic persistence failure'; END IF; RETURN NEW; END $$`);
    await testDb.raw(`CREATE ${failurePoint === 'commit' ? 'CONSTRAINT ' : ''}TRIGGER synthetic_preference_failure AFTER INSERT OR UPDATE ON user_notification_preferences ${failurePoint === 'commit' ? 'DEFERRABLE INITIALLY DEFERRED' : ''} FOR EACH ROW EXECUTE FUNCTION synthetic_preference_failure()`);
    vi.mocked(revalidatePath).mockClear();
    try {
      await expect(actions.updateUserEmailCategoryPreferencesAction(categoryId, false)).rejects.toThrow('synthetic persistence failure');
      expect(await rows()).toHaveLength(1);
      expect((await rows())[0].is_enabled).toBe(true);
      expect(revalidatePath).not.toHaveBeenCalled();
    } finally {
      await testDb.raw('DROP TRIGGER synthetic_preference_failure ON user_notification_preferences');
      await testDb.raw('DROP FUNCTION synthetic_preference_failure()');
    }
    await actions.updateUserEmailCategoryPreferencesAction(categoryId, false);
    expect(await rows()).toHaveLength(2);
    expect((await rows()).every(r => !r.is_enabled)).toBe(true);
  });

  it('leaves rows intact after a connection timeout and accepts a retry', async () => {
    await actions.updateUserEmailSubtypePreferenceAction(subtypeA, true);
    vi.mocked(createTenantKnex).mockRejectedValueOnce(new Error('Knex: Timeout acquiring a connection'));
    await expect(actions.updateUserEmailCategoryPreferencesAction(categoryId, false)).rejects.toThrow('Timeout');
    expect((await rows())[0].is_enabled).toBe(true);
    await actions.updateUserEmailCategoryPreferencesAction(categoryId, false);
    expect((await rows()).every(r => !r.is_enabled)).toBe(true);
  });

  it('enforces saved and tenant preferences at real delivery with a loopback SMTP sink', async () => {
    const { SMTPServer } = await import('smtp-server');
    const nodemailer = await import('nodemailer');
    const received: string[] = [];
    const smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'],
      onData(stream, _session, done) { let data = ''; stream.on('data', chunk => { data += chunk; }); stream.on('end', () => { received.push(data); done(); }); },
    });
    await new Promise<void>(resolve => smtp.listen(0, '127.0.0.1', resolve));
    const transport = nodemailer.createTransport({ host: '127.0.0.1', port: (smtp as any).server.address().port, secure: false, ignoreTLS: true });
    mail.send.mockImplementation(async ({ to, templateProcessor }) => {
      await transport.sendMail({ from: 'sender@example.test', to, subject: templateProcessor.subject, text: templateProcessor.text });
      return { success: true };
    });
    const service = new EmailNotificationService();
    vi.spyOn(service, 'getEffectiveTemplate').mockResolvedValue({ subject: 'Synthetic preference check', html_content: '<p>Local delivery</p>' } as any);
    const send = (subtypeId = subtypeA) => service.sendNotification({ tenant, userId, subtypeId, emailAddress: 'recipient@example.test', templateName: 'synthetic', data: {} });
    try {
      await send(); // absent preference delivers
      expect(received).toHaveLength(1);
      await actions.updateUserEmailSubtypePreferenceAction(subtypeA, false); await send();
      expect(received).toHaveLength(1);
      await actions.updateUserEmailSubtypePreferenceAction(subtypeA, true); await send();
      expect(received).toHaveLength(2);
      await testDb('user_notification_preferences').insert([{ tenant, user_id: userId, subtype_id: disabledSubtype, is_enabled: true }, { tenant, user_id: userId, subtype_id: disabledCategorySubtype, is_enabled: true }]);
      await send(disabledSubtype); await send(disabledCategorySubtype);
      expect(received).toHaveLength(2);
      await testDb('notification_settings').where({ tenant }).update({ is_enabled: false });
      await expect(send()).rejects.toThrow('disabled for this tenant');
      expect(received).toHaveLength(2);
    } finally {
      transport.close();
      await new Promise<void>(resolve => smtp.close(() => resolve()));
    }
  });
});
