import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resolveCommentAuthor } from '@alga-psa/tickets/lib';
import { tenantDb } from '@alga-psa/db';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: async () => '' })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

let mockCurrentUser: any = null;

vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  return {
    ...rbac,
    hasPermission: vi.fn(async () => true),
    getSession: vi.fn(async () => ({ user: mockCurrentUser ? { id: mockCurrentUser.user_id } : undefined })),
    withAuth: (action: any) => async (...args: any[]) => {
      const user = mockCurrentUser;
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withOptionalAuth: (action: any) => async (...args: any[]) => {
      const user = mockCurrentUser;
      if (!user) return action(null, null, ...args);
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
  };
});

vi.mock('@alga-psa/auth/rbac', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  return { ...actual, hasPermission: vi.fn(async () => true) };
});

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
}));

let getClientTicketDetails: any;
let addTicketCommentWithCache: any;

describe('Ticket bundling client portal author resolution', () => {
  let db: Knex;
  let tenantId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let internalUser: any;
  let clientUser: any;
  let childId: string;

  beforeAll(async () => {
    db = await createTestDbConnection();

    ({ getClientTicketDetails } = await import(
      '@alga-psa/client-portal/actions/client-portal-actions/client-tickets'
    ));
    ({ addTicketCommentWithCache } = await import('@alga-psa/tickets/actions/optimizedTicketActions'));

    const seeded = await tenantDb(db, '__test_discovery__')
      .unscoped('tickets', 'seed context for portal bundle author resolution test')
      .first();
    if (!seeded?.tenant) {
      throw new Error('No seeded ticket/tenant for portal bundle author resolution test');
    }
    tenantId = seeded.tenant;
    boardId = seeded.board_id;
    statusId = seeded.status_id;
    priorityId = seeded.priority_id;

    const internalUserId = uuidv4();
    await db('users').insert({
      tenant: tenantId,
      user_id: internalUserId,
      username: `agent-${uuidv4().slice(0, 8)}`,
      hashed_password: 'x',
      email: `agent-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Agent',
      last_name: 'Sender',
      user_type: 'internal',
      is_inactive: false,
    });
    internalUser = {
      user_id: internalUserId,
      tenant: tenantId,
      email: `agent-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Agent',
      last_name: 'Sender',
      user_type: 'internal',
      is_inactive: false,
    };

    const clientId = uuidv4();
    const contactId = uuidv4();
    const clientUserId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Portal Client ${uuidv4().slice(0, 6)}`,
      is_inactive: false,
    });
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Portal Contact',
      email: `portal-${uuidv4().slice(0, 8)}@example.com`,
    });
    await db('users').insert({
      tenant: tenantId,
      user_id: clientUserId,
      username: `client-${uuidv4().slice(0, 8)}`,
      hashed_password: 'x',
      email: `client-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Portal',
      last_name: 'Contact',
      user_type: 'client',
      contact_id: contactId,
      is_inactive: false,
    });
    clientUser = {
      user_id: clientUserId,
      tenant: tenantId,
      email: `client-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Portal',
      last_name: 'Contact',
      user_type: 'client',
      is_inactive: false,
    };

    const masterId = uuidv4();
    childId = uuidv4();
    const now = db.fn.now();
    await db('tickets').insert([
      {
        tenant: tenantId,
        ticket_id: masterId,
        ticket_number: `PRT-${uuidv4().slice(0, 6)}`,
        title: 'Portal master',
        client_id: clientId,
        contact_name_id: contactId,
        status_id: statusId,
        priority_id: priorityId,
        board_id: boardId,
        entered_at: now,
        updated_at: now,
        email_metadata: JSON.stringify({ messageId: `m-${uuidv4()}@mail`, threadId: `t-${uuidv4()}`, references: [] }),
      },
      {
        tenant: tenantId,
        ticket_id: childId,
        ticket_number: `PRT-${uuidv4().slice(0, 6)}`,
        title: 'Portal child',
        client_id: clientId,
        contact_name_id: contactId,
        status_id: statusId,
        priority_id: priorityId,
        board_id: boardId,
        master_ticket_id: masterId,
        entered_at: now,
        updated_at: now,
        email_metadata: JSON.stringify({ messageId: `m-${uuidv4()}@mail`, threadId: `t-${uuidv4()}`, references: [] }),
      },
    ]);
    await db('ticket_bundle_settings').insert({
      tenant: tenantId,
      master_ticket_id: masterId,
      mode: 'sync_updates',
    });

    mockCurrentUser = internalUser;
    await addTicketCommentWithCache(
      masterId,
      JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Bundled update' }] }]),
      false,
      false,
      internalUser
    );
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('returns the mirrored child comment with the agent in the portal user map', async () => {
    mockCurrentUser = clientUser;
    const result = await getClientTicketDetails(childId);

    expect(result?.conversations).toBeTruthy();
    const mirrored = (result.conversations as any[]).find((c) => c.is_system_generated);
    expect(mirrored).toBeTruthy();
    expect(mirrored.user_id).toBe(internalUser.user_id);

    const resolved = resolveCommentAuthor(mirrored, {
      userMap: result.userMap,
      contactMap: result.contactMap,
    });
    expect(resolved.source).toBe('user');
    expect(resolved.displayName).toBe('Agent Sender');
  });

  it('exposes the source comment id but never the master identity in the portal payload', async () => {
    mockCurrentUser = clientUser;
    const result = await getClientTicketDetails(childId);

    const mirrored = (result.conversations as any[]).find((c) => c.is_system_generated);
    expect(mirrored).toBeTruthy();
    expect(mirrored.bundle_mirror_source).toBeTruthy();
    expect(mirrored.bundle_mirror_source.source_comment_id).toBeTruthy();
    expect(mirrored.bundle_mirror_source.master_ticket_id).toBeUndefined();
    expect(mirrored.bundle_mirror_source.master_ticket_number).toBeUndefined();
    expect(mirrored).not.toHaveProperty('bundle_mirror_source_comment_id');
  });

  it('selects no master ticket columns when loading portal conversations', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../packages/client-portal/src/actions/client-portal-actions/client-tickets.ts'),
      'utf8'
    );
    // Anchor on the requester-visibility base query, not on the conversation
    // query alone: the portal conversation list is a clone of that base query,
    // so the base table, its audience filter and the bundle mirror join must
    // all fall inside the guarded region for the assertions below to mean
    // anything. This region is a superset of the one this test guarded when the
    // conversation query still opened its own `comments` scan.
    const start = source.indexOf("const visibleCommentsQuery = scopedDb.table('comments');");
    const end = source.indexOf('const [ticket, conversations, documents, users, linkedAssets]', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = source.slice(start, end);
    // Requester isolation: conversations must stay a clone of the audience
    // filtered base query rather than reopening an unfiltered `comments` scan.
    expect(section).toContain('const conversationsQuery = visibleCommentsQuery.clone();');
    expect(section).toContain("commentAudienceSql(trx, 'ct', 'root', 'comments'), 'requester'");
    expect(section).toContain("scopedDb.tenantJoin(conversationsQuery, 'ticket_bundle_mirrors as bm'");
    expect(section).toContain("'bm.source_comment_id as bundle_mirror_source_comment_id'");
    expect(section).not.toContain('tickets as mt');
    expect(section).not.toContain('master_ticket_id');
    expect(section).not.toContain('master_ticket_number');
  });
});
