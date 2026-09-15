import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
}));

// TicketService emits its workflow events through the server-local publisher,
// not the @alga-psa/event-bus shim, so capture those too.
vi.mock('server/src/lib/eventBus/publishers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/eventBus/publishers')>()),
  publishWorkflowEvent: publishWorkflowEventMock,
}));

// The per-record authorization decision is the seam exercised by the
// resource-denial tests: coarse RBAC stays granted, the kernel says no.
const authorizationKernelMock = vi.hoisted(() => ({
  authorizeResource: vi.fn(async () => ({ allowed: true })),
  useRealKernel: false,
}));
const bundleRulesMock = vi.hoisted(() => vi.fn<() => Promise<import('@alga-psa/authorization/kernel').BundleNarrowingRule[]>>(async () => []));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: bundleRulesMock,
}));
vi.mock('@alga-psa/authorization/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/authorization/kernel')>();
  return {
    ...actual,
    createAuthorizationKernel: (input: Parameters<typeof actual.createAuthorizationKernel>[0]) =>
      authorizationKernelMock.useRealKernel
        ? actual.createAuthorizationKernel(input)
        : { authorizeResource: authorizationKernelMock.authorizeResource },
  };
});

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import {
  addExternalLink,
  deleteTenantExternalSystem,
  findTicketByExternalLink,
  getTicketExternalLinks,
  listExternalSystems,
  removeExternalLink,
  updateExternalLink,
  upsertTenantExternalSystem,
} from '../../../../packages/tickets/src/actions/externalLinks/externalLinkActions';
import { persistExternalLinksForCreate } from '../../../../packages/tickets/src/actions/externalLinks/externalLinkPersistence';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { TicketService } from '../../lib/api/services/TicketService';
import { insertResolutionComment, insertTicket, createCloseRulesFixture, type CloseRulesFixture } from './helpers/closeRulesFixture';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let fixture: CloseRulesFixture;

function scopedDbFor(tenantId: string) {
  return tenantDb(db, tenantId);
}

function isReturnedActionError(value: unknown): value is ActionMessageError | ActionPermissionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function expectActionSuccess<T>(result: T | ActionMessageError | ActionPermissionError): T {
  if (isReturnedActionError(result)) {
    throw new Error(getErrorMessage(result));
  }
  return result;
}

describe('ticket external system links', () => {
  beforeAll(async () => {
    // TicketService resolves its own knex through the real tenant context, so
    // point the DB env at the local test Postgres before bootstrapping.
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    dbRef.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of seeded internal user for external links integration')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    dbRef.tenant = seededUser.tenant;
    userRef.user = {
      user_id: seededUser.user_id,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
    };

    fixture = await createCloseRulesFixture(db, seededUser.tenant, seededUser.user_id);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    publishEventMock.mockReset();
    publishEventMock.mockResolvedValue(undefined);
    publishWorkflowEventMock.mockReset();
    publishWorkflowEventMock.mockResolvedValue(undefined);
    authorizationKernelMock.useRealKernel = false;
    bundleRulesMock.mockReset();
    bundleRulesMock.mockResolvedValue([]);
    authorizationKernelMock.authorizeResource.mockReset();
    authorizationKernelMock.authorizeResource.mockResolvedValue({ allowed: true });
  });

  it('T300: add / list / update / remove round trip with resolved display', async () => {
    const ticketId = await insertTicket(db, fixture);

    const added = expectActionSuccess(
      await addExternalLink({
        ticket_id: ticketId,
        system: 'github',
        external_id: '42',
        realm: 'Nine-Minds/alga-psa',
        relationship: 'origin',
      }),
    );
    expect(added.system).toBe('github');
    expect(added.display.label).toBe('GitHub');
    expect(added.display.href).toBe('https://github.com/Nine-Minds/alga-psa/issues/42');

    const listed = expectActionSuccess(await getTicketExternalLinks(ticketId));
    expect(listed.map((link) => link.link_id)).toContain(added.link_id);

    const updated = expectActionSuccess(
      await updateExternalLink(added.link_id, { external_status: 'closed' }),
    );
    expect(updated.external_status).toBe('closed');

    expect(publishEventMock).toHaveBeenCalled();
    const eventTypes = publishEventMock.mock.calls.map((call: any[]) => call[0].eventType);
    expect(eventTypes).toContain('TICKET_EXTERNAL_LINK_ADDED');
    expect(eventTypes).toContain('TICKET_EXTERNAL_LINK_UPDATED');

    expectActionSuccess(await removeExternalLink(added.link_id));
    const after = expectActionSuccess(await getTicketExternalLinks(ticketId));
    expect(after).toHaveLength(0);

    const removeEventTypes = publishEventMock.mock.calls.map((call: any[]) => call[0].eventType);
    expect(removeEventTypes).toContain('TICKET_EXTERNAL_LINK_REMOVED');
  });

  it('T301: only one origin link per entity, structured origin_exists otherwise', async () => {
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(
      await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: '1', relationship: 'origin' }),
    );

    const conflict = await addExternalLink({
      ticket_id: ticketId,
      system: 'jira',
      realm: 'acme.atlassian.net',
      external_id: 'OPS-1',
      relationship: 'origin',
    });
    expect(conflict).toMatchObject({ actionError: expect.stringMatching(/origin/i) });
    expect((conflict as any).code).toBe('origin_exists');
  });

  it('T311: promoting a second link to origin through update is refused', async () => {
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(
      await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'origin-promote-1', relationship: 'origin' }),
    );
    const reference = expectActionSuccess(
      await addExternalLink({ ticket_id: ticketId, system: 'jira', realm: 'acme.atlassian.net', external_id: 'OPS-PROMOTE-2', relationship: 'reference' }),
    );

    const conflict = await updateExternalLink(reference.link_id, { relationship: 'origin' });
    expect(conflict).toMatchObject({ actionError: expect.stringMatching(/origin/i) });
    expect((conflict as any).code).toBe('origin_exists');
  });

  it('T302: duplicate external record for the same entity is rejected', async () => {
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: '7' }));

    const duplicate = await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: '7' });
    expect(duplicate).toMatchObject({ actionError: expect.stringMatching(/already linked/i) });
    expect((duplicate as any).code).toBe('duplicate_external_link');
  });

  it('T303: a comment link is rejected when the comment belongs to a different ticket', async () => {
    const ticketId = await insertTicket(db, fixture);
    const otherTicketId = await insertTicket(db, fixture);
    const commentId = await insertResolutionComment(db, fixture, otherTicketId);

    const result = await addExternalLink({
      ticket_id: ticketId,
      entity_type: 'comment',
      comment_id: commentId,
      system: 'discord',
      realm: 'guild-1',
      external_id: '123',
    });
    expect(result).toMatchObject({ actionError: expect.stringMatching(/comment not found/i) });
    expect((result as any).code).toBe('comment_not_found');

    const ok = expectActionSuccess(
      await addExternalLink({
        ticket_id: otherTicketId,
        entity_type: 'comment',
        comment_id: commentId,
        system: 'discord',
        realm: 'guild-1',
        external_id: '123',
      }),
    );
    expect(ok.entity_type).toBe('comment');
    expect(ok.entity_id).toBe(commentId);
  });

  it('T304: findTicketByExternalLink hits and misses, including external_parent_id', async () => {
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(
      await addExternalLink({
        ticket_id: ticketId,
        system: 'jira',
        realm: 'acme.atlassian.net',
        external_id: 'OPS-99',
        external_parent_id: 'OPS-EPIC',
      }),
    );

    const hit = expectActionSuccess(
      await findTicketByExternalLink({
        system: 'jira',
        external_id: 'OPS-99',
        external_parent_id: 'OPS-EPIC',
      }),
    );
    expect(hit?.ticket_id).toBe(ticketId);

    const missParent = await findTicketByExternalLink({
      system: 'jira',
      external_id: 'OPS-99',
      external_parent_id: 'OTHER-EPIC',
    });
    expect(missParent).toBeNull();

    const missSystem = await findTicketByExternalLink({ system: 'github', external_id: 'OPS-99' });
    expect(missSystem).toBeNull();
  });

  it('T305: deleting a custom system in use is refused with usage count; unused systems delete', async () => {
    const key = `custom:vendor_${uuidv4().slice(0, 6)}`;
    expectActionSuccess(
      await upsertTenantExternalSystem({ key, label: 'Vendor Portal', url_template: 'https://vendor.example/{external_id}' }),
    );

    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: key, external_id: 'CASE-1' }));

    const refused = await deleteTenantExternalSystem(key);
    expect(refused).toMatchObject({ actionError: expect.stringMatching(/used/i) });

    expectActionSuccess(await removeExternalLink(expectActionSuccess(await getTicketExternalLinks(ticketId))[0].link_id));
    expectActionSuccess(await deleteTenantExternalSystem(key));

    const systems = expectActionSuccess(await listExternalSystems());
    expect(systems.some((system) => system.key === key)).toBe(false);
  });

  it('T306: deleting a ticket cascades its external links', async () => {
    const ticketId = await insertTicket(db, fixture);
    // Insert the link directly: the FK cascade is what is under test, and going
    // through addExternalLink would also write a ticket_audit_logs row, whose own
    // ticket FK blocks the hard delete (audit history is intentionally retained).
    const [link] = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .insert({
        tenant: fixture.tenantId,
        entity_type: 'ticket',
        entity_id: ticketId,
        ticket_id: ticketId,
        system: 'slack',
        external_id: 'C1',
        relationship: 'reference',
      })
      .returning('*');

    await scopedDbFor(fixture.tenantId).table('tickets').where({ ticket_id: ticketId }).del();

    const rows = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .where({ link_id: link.link_id });
    expect(rows).toHaveLength(0);
  });

  it('T307: links are tenant-scoped', async () => {
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'isolated-1' }));

    const foreignTicket = uuidv4();
    const foreign = await addExternalLink({ ticket_id: foreignTicket, system: 'github', realm: 'acme/repo', external_id: 'isolated-2' });
    expect(foreign).toMatchObject({ actionError: expect.stringMatching(/ticket not found/i) });
    expect((foreign as any).code).toBe('ticket_not_found');

    const rows = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .where({ system: 'github', realm: 'acme/repo', external_id: 'isolated-2' });
    expect(rows).toHaveLength(0);
  });

  it('T308: add and remove write ticket audit rows with the external_link source', async () => {
    const ticketId = await insertTicket(db, fixture);
    const link = expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'audit-1' }));
    expectActionSuccess(await removeExternalLink(link.link_id));

    const audits = await scopedDbFor(fixture.tenantId)
      .table('ticket_audit_logs')
      .where({ ticket_id: ticketId })
      .whereIn('event_type', ['TICKET_EXTERNAL_LINK_ADDED', 'TICKET_EXTERNAL_LINK_REMOVED'])
      .orderBy('created_at', 'asc');
    expect(audits.map((row: any) => row.event_type)).toEqual([
      'TICKET_EXTERNAL_LINK_ADDED',
      'TICKET_EXTERNAL_LINK_REMOVED',
    ]);
    expect(audits.every((row: any) => row.source === 'external_link')).toBe(true);
  });

  async function expectRollback(
    ticketId: string,
    links: Array<{ system: string; external_id: string; relationship?: 'origin' | 'mirror' | 'reference' }>,
  ): Promise<void> {
    await expect(
      db.transaction((trx) =>
        persistExternalLinksForCreate(trx, fixture.tenantId, ticketId, links, fixture.userId),
      ),
    ).rejects.toThrow();
    const rows = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .where({ ticket_id: ticketId });
    expect(rows).toHaveLength(0);
  }

  it('T309: create-with-links rejects conflicts and rolls back atomically (no silent skip)', async () => {
    const ticketId = await insertTicket(db, fixture);

    // A malformed link rolls the batch back.
    await expectRollback(ticketId, [
      { system: 'github', realm: 'acme/repo', external_id: 'atomic-ok' },
      { system: 'github', realm: 'acme/repo', external_id: '' },
    ]);

    // Two origins for the same entity are rejected outright, not silently dropped.
    await expectRollback(ticketId, [
      { system: 'github', realm: 'acme/repo', external_id: 'origin-a', relationship: 'origin' },
      { system: 'jira', realm: 'acme.atlassian.net', external_id: 'origin-b', relationship: 'origin' },
    ]);

    // A duplicate external record within the same batch is rejected.
    await expectRollback(ticketId, [
      { system: 'github', realm: 'acme/repo', external_id: 'dup' },
      { system: 'github', realm: 'acme/repo', external_id: 'dup' },
    ]);

    // A single valid link persists and writes its planned audit entry inline.
    const first = await db.transaction((trx) =>
      persistExternalLinksForCreate(trx, fixture.tenantId, ticketId, [{ system: 'github', realm: 'acme/repo', external_id: 'atomic-ok' }], fixture.userId),
    );
    expect(first).toHaveLength(1);

    const audits = await scopedDbFor(fixture.tenantId)
      .table('ticket_audit_logs')
      .where({ ticket_id: ticketId, event_type: 'TICKET_EXTERNAL_LINK_ADDED', source: 'external_link' });
    expect(audits).toHaveLength(1);
    expect(audits[0].entity_id).toBe(first[0].link_id);
  });

  it('T310: mutations are rejected without the ticket update permission', async () => {
    const ticketId = await insertTicket(db, fixture);
    const link = expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'perm-1' }));

    hasPermissionMock.mockResolvedValue(false);

    expect(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'perm-2' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await updateExternalLink(link.link_id, { external_status: 'x' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await removeExternalLink(link.link_id)).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await upsertTenantExternalSystem({ key: 'custom:perm', label: 'Perm' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
  });

  it('T312: a read-only user can list links but cannot mutate them', async () => {
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'readonly-1' }));

    // Only `ticket:read` is granted; the UI still renders the links (criterion 2).
    hasPermissionMock.mockImplementation(async (_user: unknown, _resource: unknown, action: unknown) =>
      action === 'read',
    );

    const listed = expectActionSuccess(await getTicketExternalLinks(ticketId));
    expect(listed).toHaveLength(1);

    expect(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'readonly-2' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await removeExternalLink(listed[0].link_id)).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
  });

  it('T313: the MSP-only guard rejects a client-shaped session even with ticket permissions', async () => {
    const ticketId = await insertTicket(db, fixture);
    const internalUser = userRef.user;
    try {
      // Unit-level guard check at the withAuth/hasPermission seam: a
      // client-shaped principal that holds coarse ticket:read/update is still
      // rejected before any tenant table is touched.
      userRef.user = { ...internalUser, user_type: 'client', clientId: fixture.clientId };
      hasPermissionMock.mockResolvedValue(true);

      expect(await getTicketExternalLinks(ticketId)).toMatchObject({
        permissionError: expect.stringMatching(/Permission denied/),
      });
      expect(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'client-1' })).toMatchObject({
        permissionError: expect.stringMatching(/Permission denied/),
      });
      expect(await findTicketByExternalLink({ system: 'github', external_id: 'client-1' })).toMatchObject({
        permissionError: expect.stringMatching(/Permission denied/),
      });
      expect(await listExternalSystems()).toMatchObject({
        permissionError: expect.stringMatching(/Permission denied/),
      });
      expect(await upsertTenantExternalSystem({ key: 'custom:client', label: 'Client' })).toMatchObject({
        permissionError: expect.stringMatching(/Permission denied/),
      });
    } finally {
      userRef.user = internalUser;
    }
  });

  it('T314: create/update reject links with no clickable destination', async () => {
    const ticketId = await insertTicket(db, fixture);

    // Template system with no realm and no explicit URL.
    const noRealm = await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: 'no-realm' });
    expect((noRealm as any).code).toBe('url_required');

    // Generic system with no URL.
    const noUrl = await addExternalLink({ ticket_id: ticketId, system: 'generic', external_id: 'no-url' });
    expect((noUrl as any).code).toBe('url_required');

    // Generic system with an explicit URL is fine.
    const ok = expectActionSuccess(
      await addExternalLink({ ticket_id: ticketId, system: 'generic', external_id: 'with-url', url: 'https://example.com/x' }),
    );
    // Clearing its only URL is refused.
    const cleared = await updateExternalLink(ok.link_id, { url: null });
    expect((cleared as any).code).toBe('url_required');

    // A templated system still resolves without an explicit URL when the realm is present.
    const github = expectActionSuccess(
      await addExternalLink({
        ticket_id: ticketId,
        system: 'github',
        external_id: 'gh-1',
        realm: 'acme/repo',
        url: 'https://example.com/override',
      }),
    );
    const githubCleared = expectActionSuccess(await updateExternalLink(github.link_id, { url: null }));
    expect(githubCleared.url).toBeNull();
    expect(githubCleared.display.href).toBe('https://github.com/acme/repo/issues/gh-1');
  });

  it('T315: external_system + external_id filter the same link row', async () => {
    const service = new TicketService();
    const context = { tenant: fixture.tenantId, userId: fixture.userId } as any;
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'f-42' }));
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'jira', realm: 'acme.atlassian.net', external_id: 'f-99' }));

    // github + 99 must NOT match the ticket that has github/42 and jira/99.
    const wrong = await runWithTenant(fixture.tenantId, () =>
      service.list(
        { filters: { external_system: 'github', external_id: 'f-99' } as any, limit: 100 },
        context,
      ),
    );
    expect(wrong.data.map((t: any) => t.ticket_id)).not.toContain(ticketId);

    const right = await runWithTenant(fixture.tenantId, () =>
      service.list(
        { filters: { external_system: 'github', external_id: 'f-42' } as any, limit: 100 },
        context,
      ),
    );
    expect(right.data.map((t: any) => t.ticket_id)).toContain(ticketId);
  });

  it('T316: the real create service rejects conflicting inline links and leaves no residue', async () => {
    const service = new TicketService();
    const context = { tenant: fixture.tenantId, userId: fixture.userId } as any;
    const base = {
      client_id: fixture.clientId,
      contact_name_id: fixture.contactId,
      board_id: fixture.boardId,
      status_id: fixture.openStatusId,
      priority_id: fixture.priorityId,
    };

    publishEventMock.mockClear();
    publishWorkflowEventMock.mockClear();

    const conflictTitle = `svc-atomic-${Date.now()}`;
    await expect(
      runWithTenant(fixture.tenantId, () =>
        service.create(
          {
            ...base,
            title: conflictTitle,
            external_links: [
              { system: 'github', realm: 'acme/repo', external_id: 'svc-o1', relationship: 'origin' },
              { system: 'jira', realm: 'acme.atlassian.net', external_id: 'svc-o2', relationship: 'origin' },
            ],
          } as any,
          context,
        ),
      ),
    ).rejects.toThrow();

    const tickets = await scopedDbFor(fixture.tenantId).table('tickets').where({ title: conflictTitle });
    expect(tickets).toHaveLength(0);
    const links = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .whereIn('external_id', ['svc-o1', 'svc-o2']);
    expect(links).toHaveLength(0);
    const linkEvents = publishEventMock.mock.calls.filter(
      (call: any[]) => call[0].eventType === 'TICKET_EXTERNAL_LINK_ADDED',
    );
    expect(linkEvents).toHaveLength(0);
    const creationEvents = publishWorkflowEventMock.mock.calls.filter(
      (call: any[]) => call[0].eventType === 'TICKET_CREATED',
    );
    expect(creationEvents).toHaveLength(0);

    // A duplicate external record in the same batch also rolls the create back.
    const dupTitle = `svc-dup-${Date.now()}`;
    await expect(
      runWithTenant(fixture.tenantId, () =>
        service.create(
          {
            ...base,
            title: dupTitle,
            external_links: [
              { system: 'github', realm: 'acme/repo', external_id: 'svc-dup' },
              { system: 'github', realm: 'acme/repo', external_id: 'svc-dup' },
            ],
          } as any,
          context,
        ),
      ),
    ).rejects.toThrow();
    expect(await scopedDbFor(fixture.tenantId).table('tickets').where({ title: dupTitle })).toHaveLength(0);

    // A valid create keeps TICKET_CREATED.externalLinks and announces the link post-commit.
    publishEventMock.mockClear();
    publishWorkflowEventMock.mockClear();
    const okTitle = `svc-ok-${Date.now()}`;
    const created: any = await runWithTenant(fixture.tenantId, () =>
      service.create(
        { ...base, title: okTitle, external_links: [{ system: 'github', realm: 'acme/repo', external_id: 'svc-ok' }] } as any,
        context,
      ),
    );
    expect(created.ticket_id).toBeTruthy();
    expect(
      publishEventMock.mock.calls.some((call: any[]) => call[0].eventType === 'TICKET_EXTERNAL_LINK_ADDED'),
    ).toBe(true);
    const createdEvent = publishWorkflowEventMock.mock.calls.find(
      (call: any[]) => call[0].eventType === 'TICKET_CREATED',
    );
    expect(createdEvent?.[0]?.payload?.externalLinks?.[0]?.externalId).toBe('svc-ok');
  });

  it('T317: coarse ticket permissions do not bypass per-record resource denial', async () => {
    const ticketId = await insertTicket(db, fixture);
    const link = expectActionSuccess(
      await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'deny-1' }),
    );
    // Bootstrap a lookup target while access is allowed.
    expectActionSuccess(await findTicketByExternalLink({ system: 'github', external_id: 'deny-1' }));

    // Coarse RBAC is fully granted; only the per-record kernel denies.
    hasPermissionMock.mockResolvedValue(true);
    authorizationKernelMock.authorizeResource.mockResolvedValue({ allowed: false });

    expect(await getTicketExternalLinks(ticketId)).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(
      await addExternalLink({ ticket_id: ticketId, system: 'github', realm: 'acme/repo', external_id: 'deny-2' }),
    ).toMatchObject({ permissionError: expect.stringMatching(/Permission denied/) });
    expect(await updateExternalLink(link.link_id, { external_status: 'denied' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await removeExternalLink(link.link_id)).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await findTicketByExternalLink({ system: 'github', external_id: 'deny-1' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });

    // The denied mutations left the original link untouched.
    const rows = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .where({ ticket_id: ticketId });
    expect(rows).toHaveLength(1);
    expect(rows[0].external_status).toBeNull();
  });

  it('T318: a comment create with conflicting inline links rolls back completely', async () => {
    const service = new TicketService();
    const context = { tenant: fixture.tenantId, userId: fixture.userId } as any;
    const ticketId = await insertTicket(db, fixture);

    publishEventMock.mockClear();
    publishWorkflowEventMock.mockClear();

    await expect(
      runWithTenant(fixture.tenantId, () =>
        service.addComment(
          ticketId,
          {
            comment_text: 'atomic comment with conflicting links',
            external_links: [
              { system: 'github', realm: 'acme/repo', external_id: 'c-dup' },
              { system: 'github', realm: 'acme/repo', external_id: 'c-dup' },
            ],
          } as any,
          context,
        ),
      ),
    ).rejects.toThrow();

    const comments = await scopedDbFor(fixture.tenantId)
      .table('comments')
      .where({ note: 'atomic comment with conflicting links' });
    expect(comments).toHaveLength(0);
    const links = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .where({ external_id: 'c-dup' });
    expect(links).toHaveLength(0);
    const audits = await scopedDbFor(fixture.tenantId)
      .table('ticket_audit_logs')
      .where({ ticket_id: ticketId, event_type: 'TICKET_EXTERNAL_LINK_ADDED' });
    expect(audits).toHaveLength(0);
    expect(
      publishEventMock.mock.calls.some((call: any[]) => call[0].eventType === 'TICKET_EXTERNAL_LINK_ADDED'),
    ).toBe(false);
  });

  it.each(['read', 'update'] as const)(
    'T319: real %s narrowing blocks link mutations without side effects',
    async (restrictedAction) => {
      const ticketId = await insertTicket(db, fixture);
      const link = expectActionSuccess(await addExternalLink({
        ticket_id: ticketId,
        system: 'github',
        realm: 'acme/repo',
        external_id: `real-kernel-${restrictedAction}`,
      }));
      const linksBefore = await scopedDbFor(fixture.tenantId)
        .table('external_entity_links').where({ ticket_id: ticketId }).orderBy('link_id');
      const auditsBefore = await scopedDbFor(fixture.tenantId)
        .table('ticket_audit_logs').where({ ticket_id: ticketId }).orderBy('audit_id');

      // Use the actual kernel and providers: rules match their action exactly.
      // This read-only rule must also protect mutations, even with update RBAC.
      authorizationKernelMock.useRealKernel = true;
      bundleRulesMock.mockResolvedValue([{
        id: 'restricted-board',
        resource: 'ticket',
        action: restrictedAction,
        templateKey: 'selected_boards',
        selectedBoardIds: [uuidv4()],
      }]);
      publishEventMock.mockClear();
      publishWorkflowEventMock.mockClear();

      const denied = { permissionError: expect.stringMatching(/Permission denied/) };
      expect(await addExternalLink({
        ticket_id: ticketId,
        system: 'github',
        realm: 'acme/repo',
        external_id: `denied-real-kernel-${restrictedAction}`,
      })).toMatchObject(denied);
      expect(await updateExternalLink(link.link_id, { external_status: 'denied' })).toMatchObject(denied);
      expect(await removeExternalLink(link.link_id)).toMatchObject(denied);

      expect(await scopedDbFor(fixture.tenantId).table('external_entity_links')
        .where({ ticket_id: ticketId }).orderBy('link_id')).toEqual(linksBefore);
      expect(await scopedDbFor(fixture.tenantId).table('ticket_audit_logs')
        .where({ ticket_id: ticketId }).orderBy('audit_id')).toEqual(auditsBefore);
      expect(publishEventMock).not.toHaveBeenCalled();
      expect(publishWorkflowEventMock).not.toHaveBeenCalled();
    },
  );

});
