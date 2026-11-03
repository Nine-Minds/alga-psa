/**
 * Notification security fixture: two sponsor recipients with independent read
 * redaction policies and one customer-owned shared ticket. All records have
 * stable fixture IDs and are removed only by this layer's reset operation.
 *
 *   npm run fixtures:co-managed -- --through notification
 *   npm run fixtures:co-managed -- --through notification --verify
 *   npm run fixtures:co-managed -- --through notification --reset
 */
import type { Knex } from 'knex';
import { CREATED, id, put, type FixtureModule, type VerifyReport } from './shared';
import { OZ } from './base';

export const NOTIFICATION_CUSTOMER = id('tenant/notification-customer');
export const NOTIFICATION_CLIENT = id('client/notification-customer');
export const NOTIFICATION_SPONSOR_CLIENT = id('client/oz/notification-customer');
export const NOTIFICATION_BOARD = id('board/notification-customer');
export const NOTIFICATION_SPONSOR_BOARD = id('board/oz/notification-customer');
export const NOTIFICATION_TICKET = id('ticket/notification-customer');
export const NOTIFICATION_RELATIONSHIP = id('relationship/notification-customer');
export const NOTIFICATION_WORK = id('work/notification-customer');
export const NOTIFICATION_REFERENCE = id('reference/notification-customer');
export const NOTIFICATION_USERS = [
  { key: 'redacted', userId: id('user/oz/notification-redacted'), email: 'cm.notification.redacted@oz.test', name: 'Redacted Recipient', hidden: ['tickets.title', 'comments.content', 'assignee_name'] },
  { key: 'visible', userId: id('user/oz/notification-visible'), email: 'cm.notification.visible@oz.test', name: 'Visible Recipient', hidden: [] },
] as const;

const POLICY = Object.fromEntries(NOTIFICATION_USERS.map(user => [user.key, {
  bundleId: id(`authorization/notification-${user.key}/bundle`),
  revisionId: id(`authorization/notification-${user.key}/revision`),
  ruleId: id(`authorization/notification-${user.key}/rule`),
  assignmentId: id(`authorization/notification-${user.key}/assignment`),
}]));
const PERMISSION_ID = id('permission/oz/notification-ticket-read');
const ROLE = Object.fromEntries(NOTIFICATION_USERS.map(user => [user.key, id(`role/oz/notification-${user.key}`)]));

async function ensureTenant(trx: Knex.Transaction, tenant: string, name: string, product: string) {
  await put(trx, 'tenants', ['tenant'], { tenant, client_name: name, email: `${tenant.slice(0, 8)}@example.test`, product_code: product, created_at: CREATED, updated_at: CREATED });
}

export const notificationModule: FixtureModule = {
  name: 'notification',
  requires: ['base'],
  async apply(trx) {
    await ensureTenant(trx, NOTIFICATION_CUSTOMER, 'Notification Security Customer', 'co_managed');
    await put(trx, 'clients', ['tenant', 'client_id'], { tenant: NOTIFICATION_CUSTOMER, client_id: NOTIFICATION_CLIENT,
      client_name: 'Notification Security Customer', client_type: 'company', is_inactive: false, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'clients', ['tenant', 'client_id'], { tenant: OZ, client_id: NOTIFICATION_SPONSOR_CLIENT,
      client_name: 'Notification Security Customer', client_type: 'company', is_inactive: false, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'boards', ['tenant', 'board_id'], { tenant: NOTIFICATION_CUSTOMER, board_id: NOTIFICATION_BOARD,
      board_name: 'Notification Security', is_inactive: false });
    await put(trx, 'boards', ['tenant', 'board_id'], { tenant: OZ, board_id: NOTIFICATION_SPONSOR_BOARD,
      board_name: 'Notification Security', is_inactive: false });
    await put(trx, 'users', ['tenant', 'user_id'], { tenant: NOTIFICATION_CUSTOMER, user_id: id('user/notification-customer/admin'),
      username: 'notification-customer-admin', email: 'customer-admin@notification.test', first_name: 'Customer', last_name: 'Admin',
      hashed_password: 'fixture-only', user_type: 'internal', is_inactive: false, created_at: CREATED });

    await put(trx, 'permissions', ['tenant', 'permission_id'], { tenant: OZ, permission_id: PERMISSION_ID,
      resource: 'ticket', action: 'read', msp: true, client: false });
    for (const recipient of NOTIFICATION_USERS) {
      const roleId = ROLE[recipient.key];
      await put(trx, 'users', ['tenant', 'user_id'], { tenant: OZ, user_id: recipient.userId, username: recipient.email,
        email: recipient.email, first_name: recipient.name.split(' ')[0], last_name: recipient.name.split(' ')[1],
        hashed_password: 'fixture-only', user_type: 'internal', is_inactive: false, created_at: CREATED });
      await put(trx, 'roles', ['tenant', 'role_id'], { tenant: OZ, role_id: roleId,
        role_name: `Notification ${recipient.name}`, msp: true, client: false });
      await put(trx, 'role_permissions', ['tenant', 'role_id', 'permission_id'], { tenant: OZ, role_id: roleId, permission_id: PERMISSION_ID });
      await put(trx, 'user_roles', ['tenant', 'user_id', 'role_id'], { tenant: OZ, user_id: recipient.userId, role_id: roleId });
      const policy = POLICY[recipient.key];
      await put(trx, 'authorization_bundles', ['tenant', 'bundle_id'], { tenant: OZ, bundle_id: policy.bundleId,
        bundle_key: `notification-${recipient.key}`, name: `Notification ${recipient.name} policy`, is_system: false,
        status: 'active', published_revision_id: null, created_at: CREATED, updated_at: CREATED });
      await put(trx, 'authorization_bundle_revisions', ['tenant', 'revision_id'], { tenant: OZ, revision_id: policy.revisionId,
        bundle_id: policy.bundleId, revision_number: 1, lifecycle_state: 'published', published_at: CREATED, created_at: CREATED, updated_at: CREATED });
      await put(trx, 'authorization_bundle_rules', ['tenant', 'rule_id'], { tenant: OZ, rule_id: policy.ruleId, bundle_id: policy.bundleId,
        revision_id: policy.revisionId, resource_type: 'ticket', action: 'read', template_key: 'selected_clients',
        effect: 'narrow', constraint_key: null, config: JSON.stringify({ selectedClientIds: [NOTIFICATION_SPONSOR_CLIENT], redactedFields: recipient.hidden }), position: 0, created_at: CREATED, updated_at: CREATED });
      await trx('authorization_bundles').where({ tenant: OZ, bundle_id: policy.bundleId }).update({ published_revision_id: policy.revisionId });
      await put(trx, 'authorization_bundle_assignments', ['tenant', 'assignment_id'], { tenant: OZ, assignment_id: policy.assignmentId,
        bundle_id: policy.bundleId, target_type: 'user', target_id: recipient.userId, status: 'active', created_at: CREATED, updated_at: CREATED });
      await put(trx, 'co_management_staff_assignments', ['tenant', 'customer_tenant', 'relationship_id', 'principal_type', 'principal_id'], {
        tenant: OZ, customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP,
        principal_type: 'user', principal_id: recipient.userId, relationship_role: 'technician', created_at: CREATED });
    }
    await put(trx, 'co_management_relationships', ['tenant', 'relationship_id'], { tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP, sponsor_tenant: OZ, sponsor_client_id: NOTIFICATION_SPONSOR_CLIENT,
      state: 'active', visibility_mode: 'escalation_only', revision: 1, accepted_by: id('user/notification-customer/admin'),
      accepted_at: CREATED, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'tickets', ['tenant', 'ticket_id'], { tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET,
      ticket_number: 'NOTIFY-001', title: 'Fixture restricted title', client_id: NOTIFICATION_CLIENT, board_id: NOTIFICATION_BOARD,
      entered_by: id('user/notification-customer/admin'), entered_at: CREATED, updated_at: CREATED, is_closed: false });
    await put(trx, 'co_management_ticket_work', ['tenant', 'relationship_id', 'ticket_id'], { tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP, ticket_id: NOTIFICATION_TICKET, work_id: NOTIFICATION_WORK, revision: 1,
      responsibility: 'msp', can_collaborate: true, first_escalated_at: CREATED, last_transition_at: CREATED });
    await put(trx, 'co_managed_ticket_references', ['tenant', 'reference_id'], { tenant: OZ, reference_id: NOTIFICATION_REFERENCE,
      customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, ticket_id: NOTIFICATION_TICKET,
      work_id: NOTIFICATION_WORK, client_id: NOTIFICATION_SPONSOR_CLIENT, board_id: NOTIFICATION_SPONSOR_BOARD,
      assigned_to: NOTIFICATION_USERS[0].userId, created_at: CREATED, updated_at: CREATED });
  },
  async verify(db) {
    const customer = await db('tenants').where({ tenant: NOTIFICATION_CUSTOMER, product_code: 'co_managed' }).first('tenant');
    const relationship = await db('co_management_relationships').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, sponsor_tenant: OZ, state: 'active' }).first('relationship_id');
    const ticket = await db('tickets').where({ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }).first('ticket_id');
    const work = await db('co_management_ticket_work').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, ticket_id: NOTIFICATION_TICKET }).first('work_id');
    const reports: VerifyReport[] = [
      { ok: Boolean(customer), area: 'notification', detail: 'fixture-owned customer workspace exists' },
      { ok: Boolean(relationship && ticket && work), area: 'notification', detail: 'active relationship and escalated shared ticket exist' },
    ];
    for (const recipient of NOTIFICATION_USERS) {
      const assignment = await db('authorization_bundle_assignments').where({ tenant: OZ, assignment_id: POLICY[recipient.key].assignmentId, target_id: recipient.userId, status: 'active' }).first();
      const rule = await db('authorization_bundle_rules').where({ tenant: OZ, rule_id: POLICY[recipient.key].ruleId }).first();
      reports.push({ ok: Boolean(assignment && rule && JSON.stringify(rule.config?.redactedFields ?? []) === JSON.stringify(recipient.hidden)), area: 'notification', detail: `${recipient.key} recipient-specific read redaction policy exists` });
    }
    return reports;
  },
  async reset(trx) {
    await trx('co_management_deliveries').where({ tenant: NOTIFICATION_CUSTOMER, source_id: id('source/notification-routing-recovery') }).delete();
    await trx('co_managed_ticket_references').where({ tenant: OZ, reference_id: NOTIFICATION_REFERENCE }).delete();
    await trx('co_management_ticket_work').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('co_management_staff_assignments').where({ tenant: OZ, customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('co_management_board_scopes').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('co_management_relationships').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('tickets').where({ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }).delete();
    await trx('authorization_bundle_assignments').whereIn('assignment_id', NOTIFICATION_USERS.map(user => POLICY[user.key].assignmentId)).andWhere({ tenant: OZ }).delete();
    await trx('authorization_bundle_rules').whereIn('rule_id', NOTIFICATION_USERS.map(user => POLICY[user.key].ruleId)).andWhere({ tenant: OZ }).delete();
    await trx('authorization_bundles').whereIn('bundle_id', NOTIFICATION_USERS.map(user => POLICY[user.key].bundleId)).andWhere({ tenant: OZ }).update({ published_revision_id: null });
    await trx('authorization_bundle_revisions').whereIn('revision_id', NOTIFICATION_USERS.map(user => POLICY[user.key].revisionId)).andWhere({ tenant: OZ }).delete();
    await trx('authorization_bundles').whereIn('bundle_id', NOTIFICATION_USERS.map(user => POLICY[user.key].bundleId)).andWhere({ tenant: OZ }).delete();
    for (const user of NOTIFICATION_USERS) {
      await trx('user_roles').where({ tenant: OZ, user_id: user.userId }).delete();
      await trx('users').where({ tenant: OZ, user_id: user.userId }).delete();
    }
    await trx('role_permissions').where({ tenant: OZ, permission_id: PERMISSION_ID }).delete();
    await trx('roles').whereIn('role_id', NOTIFICATION_USERS.map(user => ROLE[user.key])).andWhere({ tenant: OZ }).delete();
    await trx('permissions').where({ tenant: OZ, permission_id: PERMISSION_ID }).delete();
    await trx('users').where({ tenant: NOTIFICATION_CUSTOMER, user_id: id('user/notification-customer/admin') }).delete();
    await trx('boards').where({ tenant: NOTIFICATION_CUSTOMER, board_id: NOTIFICATION_BOARD }).delete();
    await trx('boards').where({ tenant: OZ, board_id: NOTIFICATION_SPONSOR_BOARD }).delete();
    await trx('clients').where({ tenant: NOTIFICATION_CUSTOMER, client_id: NOTIFICATION_CLIENT }).delete();
    await trx('clients').where({ tenant: OZ, client_id: NOTIFICATION_SPONSOR_CLIENT }).delete();
    await trx('tenants').where({ tenant: NOTIFICATION_CUSTOMER }).delete();
  },
};
