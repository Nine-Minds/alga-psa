import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';
import { escalateCoManagedTicket, handBackCoManagedTicket } from '../../../../../packages/co-managed/src/ticketHandoffs';
import { withCoManagedStoredRoutingNotification, withCoManagedTicketRoutingNotification } from '../../../../../packages/co-managed/src/ticketRoutingNotifications';
import { processCoManagedRoutingEmailDeliveries } from '../../../../../packages/co-managed/src/ticketRoutingEmailDeliveries';
import { persistCoManagedRoutingNotifications } from '../../../../../packages/notifications/src/lib/coManagedRoutingNotifications';
import { withNotificationDelivery } from '../../../../../packages/notifications/src/lib/notificationDelivery';

const E = 'co_management_ticket_routing_events', R = 'co_management_ticket_routing_recipients';
export function registerCoManagedTicketRoutingNotificationTests(getDb: () => Knex, handoffFixture: () => Promise<any>, withAssignment: (work: (f: any) => Promise<void>) => Promise<void>) {
  const request = (revision: number) => ({ operationId: randomUUID(), expectedRevision: revision, note: 'Shared handoff note remains in the ticket history.' });
  const recipient = (actor: any) => ({ kind: 'notification_recipient' as const, tenant: actor.tenant, userId: actor.userId });
  async function assign(f: any) {
    const input = { operationId: randomUUID(), expectedRevision: 1, assignee: f.selected };
    await f.assignments.assignCoManagedTicket(getDb(), f.customerPrincipal, f.resource, input); return input;
  }

  it('routing notifications persist canonical escalation and handback obligations with qualified local destinations and exact retry', async () => {
    const db = getDb(), f = await handoffFixture();
    await f.sponsor.table('boards').where('board_id', f.operation.escalation_board_id).update({ manager_user_id: f.principal.userId });
    await f.customer.table('tickets').where('ticket_id', f.resource.id).update({ assigned_to: f.customerPrincipal.userId });
    const input = request(0), result = await escalateCoManagedTicket(db, f.customerPrincipal, f.resource, input);
    expect(await escalateCoManagedTicket(db, f.customerPrincipal, f.resource, input)).toEqual(result);
    expect(await f.sponsor.table(E)).toHaveLength(1);
    expect(await f.sponsor.table(R)).toHaveLength(2);
    expect(await f.customer.table(R)).toHaveLength(0);
    await Promise.all([persistCoManagedRoutingNotifications(db, f.principal.tenant), persistCoManagedRoutingNotifications(db, f.principal.tenant)]);
    const notices = await f.sponsor.table('internal_notifications'); expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain('escalated to your MSP');
    expect(notices[0].link).toContain(`/co-management/tickets/${f.resource.tenant}/${f.resource.relationshipId}/${f.resource.id}`);
    expect(await f.sponsor.table('co_management_notification_deliveries')).toHaveLength(3);
    const deliver = vi.fn(async (_notification: any) => 'sent');
    expect(await withNotificationDelivery(db, notices[0], deliver)).toBe('sent');
    expect(deliver.mock.calls[0][0].metadata.coManaged).toMatchObject({ version: 4, kind: 'ticket_routing', eventId: input.operationId });
    const back = request(1); await handBackCoManagedTicket(db, f.principal, f.resource, back);
    await persistCoManagedRoutingNotifications(db, f.resource.tenant);
    const ownerNotices = await f.customer.table('internal_notifications'); expect(ownerNotices).toHaveLength(1);
    expect(ownerNotices[0]).toMatchObject({ user_id: f.customerPrincipal.userId, link: `/msp/tickets/${f.resource.id}` });
    expect(ownerNotices[0].message).toContain('handed back');
    expect(await withNotificationDelivery(db, notices[0], deliver)).toBeNull();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await withCoManagedStoredRoutingNotification(db, f.principal, notices[0].internal_notification_id, async message => message.transition)).toBe('escalated');
  });

  it('routing notifications create one assignment notice and one email with stable retry identity and no customer mail', async () => withAssignment(async f => {
    const db = getDb(), input = await assign(f);
    await f.assignments.assignCoManagedTicket(db, f.customerPrincipal, f.resource, input);
    await f.sponsor.table('users').where('user_id', f.principal.userId).update({ email: 'routing-tech@example.test' });
    await persistCoManagedRoutingNotifications(db, f.principal.tenant);
    const notice = await f.sponsor.table('internal_notifications').first();
    expect(notice).toMatchObject({ template_name: 'co-managed-ticket-assigned', user_id: f.principal.userId });
    const send = vi.fn().mockResolvedValueOnce({ status: 'failed', retryable: true, errorCode: 'provider_down' }).mockResolvedValue({ status: 'delivered' });
    await processCoManagedRoutingEmailDeliveries(db, f.principal.tenant, send);
    expect(send).toHaveBeenCalledTimes(1);
    await f.sponsor.table(R).where({ event_id: input.operationId, channel: 'email' }).update({ next_attempt_at: db.raw('now()') });
    await Promise.all([processCoManagedRoutingEmailDeliveries(db, f.principal.tenant, send), processCoManagedRoutingEmailDeliveries(db, f.principal.tenant, send)]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].messageId).toBe(send.mock.calls[0][0].messageId);
    expect(send.mock.calls[0][0]).toMatchObject({ tenant: f.principal.tenant, recipientUserId: f.principal.userId, message: { resource: f.resource, transition: 'assigned' } });
    expect(await f.customer.table(R)).toHaveLength(0);
    await persistCoManagedRoutingNotifications(db, f.principal.tenant);
    expect(await f.sponsor.table('internal_notifications')).toHaveLength(1);
  }));

  it.each(['unassigned', 'revoked', 'inactive', 'denied'] as const)('routing notifications skip delayed delivery when recipient becomes %s', async reason => withAssignment(async f => {
    const db = getDb(), input = await assign(f);
    if (reason === 'unassigned') await f.assignments.assignCoManagedTicket(db, f.customerPrincipal, f.resource, { operationId: randomUUID(), expectedRevision: 2, assignee: null });
    if (reason === 'revoked') await f.customer.table('co_management_ticket_work').where('ticket_id', f.resource.id).update({ grant_revoked_at: db.raw('now()'), can_collaborate: false });
    if (reason === 'inactive') await f.sponsor.table('users').where('user_id', f.principal.userId).update({ is_inactive: true });
    if (reason === 'denied') await f.sponsor.table('role_permissions').whereIn('permission_id', f.sponsor.table('permissions').where({ resource: 'ticket', action: 'read' }).select('permission_id')).delete();
    await persistCoManagedRoutingNotifications(db, f.principal.tenant);
    const send = vi.fn(); await processCoManagedRoutingEmailDeliveries(db, f.principal.tenant, send);
    expect(send).not.toHaveBeenCalled(); expect(await f.sponsor.table('internal_notifications')).toHaveLength(0);
    expect((await f.sponsor.table(R).where('event_id', input.operationId)).every((row: any) => row.status === 'skipped')).toBe(true);
  }));

  it('routing notifications never deliver cached content with forged metadata or a removed routing receipt', async () => withAssignment(async f => {
    const db = getDb(); await assign(f); await persistCoManagedRoutingNotifications(db, f.principal.tenant);
    const notice = await f.sponsor.table('internal_notifications').first(), deliver = vi.fn();
    await f.sponsor.table('internal_notifications').where('internal_notification_id', notice.internal_notification_id).update({ metadata: {}, title: 'Cached secret' });
    expect(await withNotificationDelivery(db, { ...notice, metadata: {} }, deliver)).toBeNull();
    await f.sponsor.table('internal_notifications').where('internal_notification_id', notice.internal_notification_id).update({ metadata: notice.metadata });
    await f.sponsor.table(R).where('notification_id', notice.internal_notification_id).delete();
    expect(await withNotificationDelivery(db, notice, deliver)).toBeNull(); expect(deliver).not.toHaveBeenCalled();
    await f.sponsor.table('internal_notifications').where('internal_notification_id', notice.internal_notification_id).update({ metadata: {} });
    expect(await withNotificationDelivery(db, { ...notice, metadata: {} }, deliver)).toBeNull(); expect(deliver).not.toHaveBeenCalled();
  }));

  it('routing notifications honor terminal disabled preferences and recipient team removal', async () => withAssignment(async f => {
    const db = getDb(), teamId = randomUUID();
    await f.sponsor.table('teams').insert({ tenant: f.principal.tenant, team_id: teamId, team_name: 'Routing team', manager_id: f.principal.userId });
    await f.sponsor.table('team_members').insert({ tenant: f.principal.tenant, team_id: teamId, user_id: f.principal.userId });
    await f.sponsor.table('co_management_staff_assignments').insert({ tenant: f.principal.tenant, customer_tenant: f.resource.tenant,
      relationship_id: f.resource.relationshipId, principal_type: 'team', principal_id: teamId, relationship_role: 'technician' });
    const input = { operationId: randomUUID(), expectedRevision: 1, assignee: { tenant: f.principal.tenant, kind: 'team', id: teamId } };
    await f.assignments.assignCoManagedTicket(db, f.customerPrincipal, f.resource, input);
    expect(await f.sponsor.table(R).where('event_id', input.operationId)).toHaveLength(2);
    const subtype = await db('internal_notification_subtypes').where('name', 'ticket-assigned').first();
    await f.sponsor.table('user_internal_notification_preferences').insert({ tenant: f.principal.tenant, user_id: f.principal.userId,
      category_id: subtype.internal_category_id, subtype_id: subtype.internal_notification_subtype_id, is_enabled: false });
    await persistCoManagedRoutingNotifications(db, f.principal.tenant);
    expect(await f.sponsor.table(R).where({ event_id: input.operationId, channel: 'in_app' }).first()).toMatchObject({ status: 'disabled' });
    await f.sponsor.table('user_internal_notification_preferences').where('user_id', f.principal.userId).update({ is_enabled: true });
    await persistCoManagedRoutingNotifications(db, f.principal.tenant);
    expect(await f.sponsor.table('internal_notifications')).toHaveLength(0);
    await f.sponsor.table('team_members').where('team_id', teamId).delete();
    const send = vi.fn(); await processCoManagedRoutingEmailDeliveries(db, f.principal.tenant, send);
    expect(send).not.toHaveBeenCalled();
    expect(await f.sponsor.table(R).where({ event_id: input.operationId, channel: 'email' }).first()).toMatchObject({ status: 'skipped' });
  }));

  it('routing notifications rebuild field-redacted content and suppress hidden routing state', async () => withAssignment(async f => {
    const db = getDb(), input = await assign(f), bundles = await import('@alga-psa/authorization');
    await persistCoManagedRoutingNotifications(db, f.principal.tenant);
    const notice = await f.sponsor.table('internal_notifications').first();
    const { bundleId, revisionId } = await bundles.createAuthorizationBundle(db, { tenant: f.principal.tenant, name: 'Routing read', actorUserId: f.principal.userId });
    await bundles.upsertBundleRule(db, { tenant: f.principal.tenant, bundleId, revisionId, resourceType: 'ticket', action: 'read',
      templateKey: 'selected_clients', config: { selectedClientIds: [f.operation.request.clientId], redactedFields: ['title', 'ticket_number'] } });
    await bundles.publishBundleRevision(db, { tenant: f.principal.tenant, bundleId, revisionId, actorUserId: f.principal.userId });
    await bundles.createBundleAssignment(db, { tenant: f.principal.tenant, bundleId, targetType: 'user', targetId: f.principal.userId });
    const deliver = vi.fn(async (value: any) => value);
    const current = await withNotificationDelivery(db, notice, deliver);
    expect(current?.message).not.toContain('Customer issue'); expect(current?.message).not.toContain('SHARED-1');
    await f.sponsor.table('authorization_bundle_rules').where('revision_id', revisionId).update({ config: { selectedClientIds: [f.operation.request.clientId], redactedFields: ['responsibility'] } });
    expect(await withCoManagedTicketRoutingNotification(db, recipient(f.principal), input.operationId, 'email', async () => true)).toBeNull();
    expect(await withNotificationDelivery(db, notice, deliver)).toBeNull();
  }));

  it('routing notification obligations roll back with their canonical handoff transaction', async () => {
    const db = getDb(), f = await handoffFixture(), input = request(0);
    await expect(db.transaction(async trx => { await escalateCoManagedTicket(trx, f.customerPrincipal, f.resource, input); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await f.sponsor.table(E)).toHaveLength(0); expect(await f.sponsor.table(R)).toHaveLength(0);
    expect(await f.customer.table('co_management_ticket_work')).toHaveLength(0);
  });
}
