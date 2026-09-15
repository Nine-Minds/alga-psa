import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

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
import { tenantDb } from '@alga-psa/db';
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
      await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: '1', relationship: 'origin' }),
    );

    const conflict = await addExternalLink({
      ticket_id: ticketId,
      system: 'jira',
      external_id: 'OPS-1',
      relationship: 'origin',
    });
    expect(conflict).toMatchObject({ actionError: expect.stringMatching(/origin/i) });
    expect((conflict as any).code).toBe('origin_exists');
  });

  it('T311: promoting a second link to origin through update is refused', async () => {
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(
      await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: 'origin-promote-1', relationship: 'origin' }),
    );
    const reference = expectActionSuccess(
      await addExternalLink({ ticket_id: ticketId, system: 'jira', external_id: 'OPS-PROMOTE-2', relationship: 'reference' }),
    );

    const conflict = await updateExternalLink(reference.link_id, { relationship: 'origin' });
    expect(conflict).toMatchObject({ actionError: expect.stringMatching(/origin/i) });
    expect((conflict as any).code).toBe('origin_exists');
  });

  it('T302: duplicate external record for the same entity is rejected', async () => {
    const ticketId = await insertTicket(db, fixture);
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: '7' }));

    const duplicate = await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: '7' });
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
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: 'isolated-1' }));

    const foreignTicket = uuidv4();
    const foreign = await addExternalLink({ ticket_id: foreignTicket, system: 'github', external_id: 'isolated-2' });
    expect(foreign).toMatchObject({ actionError: expect.stringMatching(/ticket not found/i) });
    expect((foreign as any).code).toBe('ticket_not_found');

    const rows = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .where({ system: 'github', external_id: 'isolated-2' });
    expect(rows).toHaveLength(0);
  });

  it('T308: add and remove write ticket audit rows with the external_link source', async () => {
    const ticketId = await insertTicket(db, fixture);
    const link = expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: 'audit-1' }));
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

  it('T309: create-with-links persistence rolls back atomically and skips duplicates idempotently', async () => {
    const ticketId = await insertTicket(db, fixture);

    await expect(
      db.transaction(async (trx) => {
        await persistExternalLinksForCreate(
          trx,
          fixture.tenantId,
          ticketId,
          [
            { system: 'github', external_id: 'atomic-ok' },
            { system: 'github', external_id: '' },
          ],
          fixture.userId,
        );
      }),
    ).rejects.toThrow();

    const rows = await scopedDbFor(fixture.tenantId)
      .table('external_entity_links')
      .where({ ticket_id: ticketId });
    expect(rows).toHaveLength(0);

    const first = await db.transaction((trx) =>
      persistExternalLinksForCreate(trx, fixture.tenantId, ticketId, [{ system: 'github', external_id: 'atomic-ok' }], fixture.userId),
    );
    expect(first).toHaveLength(1);
    const second = await db.transaction((trx) =>
      persistExternalLinksForCreate(trx, fixture.tenantId, ticketId, [{ system: 'github', external_id: 'atomic-ok' }], fixture.userId),
    );
    expect(second).toHaveLength(0);
  });

  it('T310: mutations are rejected without the ticket update permission', async () => {
    const ticketId = await insertTicket(db, fixture);
    const link = expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: 'perm-1' }));

    hasPermissionMock.mockResolvedValue(false);

    expect(await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: 'perm-2' })).toMatchObject({
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
    expectActionSuccess(await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: 'readonly-1' }));

    // Only `ticket:read` is granted; the UI still renders the links (criterion 2).
    hasPermissionMock.mockImplementation(async (_user: unknown, _resource: unknown, action: unknown) =>
      action === 'read',
    );

    const listed = expectActionSuccess(await getTicketExternalLinks(ticketId));
    expect(listed).toHaveLength(1);

    expect(await addExternalLink({ ticket_id: ticketId, system: 'github', external_id: 'readonly-2' })).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
    expect(await removeExternalLink(listed[0].link_id)).toMatchObject({
      permissionError: expect.stringMatching(/Permission denied/),
    });
  });
});
