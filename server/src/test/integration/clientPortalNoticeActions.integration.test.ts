/**
 * T007: client portal notice MSP actions against a real migrated database
 * (plan pl-737e90f8, S3). Runs the real actions; only auth and the connection
 * source are stubbed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createTenant, createClient, createUser } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();

let db: Knex;
let currentUser: any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, createTenantKnex: async () => ({ knex: db, tenant: currentUser.tenant }) };
});

const NOTICES = 'client_portal_notices';
const TARGETS = 'client_portal_notice_targets';
const DISMISSALS = 'client_portal_notice_dismissals';

describeDb('client portal notice actions (DB-backed)', () => {
  let tenant: string;
  let userId: string;
  let clientA: string;
  let clientB: string;
  let clientC: string;
  let tagId: string;
  let actions: typeof import('../../../../packages/client-portal/src/actions/client-portal-actions/clientPortalNoticeActions');

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    tenant = await createTenant(db);
    userId = await createUser(db, tenant);
    currentUser = { user_id: userId, tenant, user_type: 'internal' };
    clientA = await createClient(db, tenant, 'Acme Alpha');
    clientB = await createClient(db, tenant, 'Beta Corp');
    clientC = await createClient(db, tenant, 'Gamma LLC');
    tagId = uuidv4();
    await db('tag_definitions').insert({ tenant, tag_id: tagId, tag_text: 'vip', tagged_type: 'client' });
    await db('tag_mappings').insert({ tenant, mapping_id: uuidv4(), tag_id: tagId, tagged_id: clientC, tagged_type: 'client' });
    actions = await import('../../../../packages/client-portal/src/actions/client-portal-actions/clientPortalNoticeActions');
  }, 240_000);

  afterAll(async () => {
    if (!db) return;
    await db(DISMISSALS).where({ tenant }).delete();
    await db(TARGETS).where({ tenant }).delete();
    await db(NOTICES).where({ tenant }).delete();
    await db('tag_mappings').where({ tenant }).delete();
    await db('tag_definitions').where({ tenant }).delete();
    await db('clients').where({ tenant }).delete();
    await db('users').where({ tenant }).delete();
    await db('tenants').where({ tenant }).delete();
    await db.destroy().catch(() => undefined);
  }, 60_000);

  const base = (over: Record<string, unknown> = {}) => ({
    severity: 'warning',
    content: { default: { message: 'Maintenance tonight' } },
    dismissible: true,
    audience_type: 'clients',
    audience_client_ids: [clientA, clientB],
    ...over,
  });

  it('create -> update (replace targets, clear/keep dismissals) -> delete', async () => {
    // Create with client targets.
    const created: any = await actions.createClientPortalNotice(base() as any);
    expect(created.success).toBe(true);
    const noticeId: string = created.noticeId;
    let targets = await db(TARGETS).where({ tenant, notice_id: noticeId });
    expect(targets.map((t) => t.target_id).sort()).toEqual([clientA, clientB].sort());
    expect(targets.every((t) => t.target_type === 'client')).toBe(true);
    const row = await db(NOTICES).where({ tenant, notice_id: noticeId }).first();
    expect(row.created_by).toBe(userId);

    // Unknown target is rejected and writes nothing.
    const bad: any = await actions.createClientPortalNotice(base({ audience_client_ids: [uuidv4()] }) as any);
    expect(bad).toMatchObject({ success: false, code: 'invalid_targets' });
    // Validation failures are returned, not thrown.
    const invalid: any = await actions.createClientPortalNotice(base({ severity: 'nope' }) as any);
    expect(invalid).toMatchObject({ success: false, code: 'validation' });
    expect(await db(NOTICES).where({ tenant }).count({ c: '*' }).first()).toMatchObject({ c: '1' });

    // Schedule-only change keeps a seeded dismissal.
    await db(DISMISSALS).insert({ tenant, notice_id: noticeId, user_id: userId });
    const schedule: any = await actions.updateClientPortalNotice(noticeId, base({ ends_at: '2099-01-01T00:00:00Z' }) as any);
    expect(schedule.success).toBe(true);
    expect(await db(DISMISSALS).where({ tenant, notice_id: noticeId })).toHaveLength(1);

    // Content + audience change: targets replaced (not appended), dismissals cleared.
    const updated: any = await actions.updateClientPortalNotice(noticeId, base({
      content: { default: { message: 'Changed message' } },
      audience_type: 'tags',
      audience_client_ids: undefined,
      audience_tag_ids: [tagId],
    }) as any);
    expect(updated.success).toBe(true);
    targets = await db(TARGETS).where({ tenant, notice_id: noticeId });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ target_type: 'tag', target_id: tagId });
    expect(await db(DISMISSALS).where({ tenant, notice_id: noticeId })).toHaveLength(0);

    // Content-only change also clears dismissals.
    await db(DISMISSALS).insert({ tenant, notice_id: noticeId, user_id: userId });
    await actions.updateClientPortalNotice(noticeId, base({
      content: { default: { message: 'Changed again' } }, audience_type: 'tags',
      audience_client_ids: undefined, audience_tag_ids: [tagId],
    }) as any);
    expect(await db(DISMISSALS).where({ tenant, notice_id: noticeId })).toHaveLength(0);

    // Read side: names, derived status, preview.
    const list: any = await actions.listClientPortalNotices();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'live', audience_tag_names: ['vip'], audience_client_names: [] });
    const got: any = await actions.getClientPortalNotice(noticeId);
    expect(got.notice.audience_tags).toEqual([{ id: tagId, name: 'vip' }]);
    expect(await actions.previewClientPortalNoticeAudience({ audienceType: 'tags', targetIds: [tagId] })).toEqual(['Gamma LLC']);
    expect(await actions.previewClientPortalNoticeAudience({ audienceType: 'all', targetIds: [] })).toEqual(['Acme Alpha', 'Beta Corp', 'Gamma LLC']);
    expect(await actions.previewClientPortalNoticeAudience({ audienceType: 'clients', targetIds: [clientB] })).toEqual(['Beta Corp']);

    // Delete leaves nothing in any table.
    await db(DISMISSALS).insert({ tenant, notice_id: noticeId, user_id: userId });
    expect(await actions.deleteClientPortalNotice(noticeId)).toEqual({ success: true });
    for (const table of [NOTICES, TARGETS, DISMISSALS]) {
      expect(await db(table).where({ tenant })).toHaveLength(0);
    }
    expect(await actions.getClientPortalNotice(noticeId)).toMatchObject({ success: false, code: 'not_found' });
  }, 60_000);

  it('scopes every row to the acting tenant', async () => {
    const created: any = await actions.createClientPortalNotice(base() as any);
    expect(created.success).toBe(true);
    const rows = [
      ...(await db(NOTICES).where({ notice_id: created.noticeId })),
      ...(await db(TARGETS).where({ notice_id: created.noticeId })),
    ];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant === tenant)).toBe(true);
    // Another tenant sees nothing.
    const other = currentUser;
    currentUser = { ...other, tenant: uuidv4() };
    expect(await actions.listClientPortalNotices()).toEqual([]);
    currentUser = other;
    await actions.deleteClientPortalNotice(created.noticeId);
  }, 30_000);
});
