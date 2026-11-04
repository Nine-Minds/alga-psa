/**
 * Isolated notification-security fixture. Both tenants and every row they own
 * are card-specific, so apply/reset never edits the shared Oz review tenant.
 */
import type { Knex } from 'knex';
import { CREATED, ensure, fingerprint, id, put, VALID_UNTIL, type FixtureEngines, type FixtureModule, type VerifyReport } from './shared';

export const NOTIFICATION_CUSTOMER = id('tenant/notification-customer');
export const NOTIFICATION_SPONSOR = id('tenant/notification-sponsor');
export const NOTIFICATION_CLIENT = id('client/notification-customer');
export const NOTIFICATION_SPONSOR_CLIENT = id('client/notification-sponsor');
export const NOTIFICATION_SPONSOR_HOME_CLIENT = id('client/notification-sponsor/self');
export const NOTIFICATION_BOARD = id('board/notification-customer');
export const NOTIFICATION_SPONSOR_BOARD = id('board/notification-sponsor');
export const NOTIFICATION_TICKET = id('ticket/notification-customer');
export const NOTIFICATION_RELATIONSHIP = id('relationship/notification-customer');
export const NOTIFICATION_WORK = id('work/notification-customer');
export const NOTIFICATION_REFERENCE = id('reference/notification-customer');
export const NOTIFICATION_OPERATION = id('operation/notification-customer');
export const NOTIFICATION_ALLOCATION = id('allocation/notification-customer');
export const NOTIFICATION_INVITATION = id('invitation/notification-customer');

export const NOTIFICATION_CUSTOMER_ADMIN = {
  userId: id('user/notification-customer/admin'), email: 'customer-admin@notification.test',
  password: 'FixtureNotificationCustomer!2026',
};
export const NOTIFICATION_USERS = [
  { key: 'redacted', userId: id('user/notification-sponsor/redacted'), email: 'cm.notification.redacted@notification.test', name: 'Redacted Recipient', password: 'FixtureNotificationRedacted!2026', hidden: ['tickets.title', 'comments.content', 'assignee_name'] },
  { key: 'visible', userId: id('user/notification-sponsor/visible'), email: 'cm.notification.visible@notification.test', name: 'Visible Recipient', password: 'FixtureNotificationVisible!2026', hidden: [] },
] as const;

const POLICY = Object.fromEntries(NOTIFICATION_USERS.map(user => [user.key, {
  bundleId: id(`authorization/notification-${user.key}/bundle`),
  revisionId: id(`authorization/notification-${user.key}/revision`),
  ruleId: id(`authorization/notification-${user.key}/rule`),
  assignmentId: id(`authorization/notification-${user.key}/assignment`),
}])) as Record<(typeof NOTIFICATION_USERS)[number]['key'], { bundleId: string; revisionId: string; ruleId: string; assignmentId: string }>;
const PERMISSION_ID = id('permission/notification-ticket-read');
const CLIENT_READ_PERMISSION_ID = id('permission/notification-client-read');
const MANAGEMENT_READ_PERMISSION_ID = id('permission/notification-management-read');
const MANAGEMENT_PERMISSION_ID = id('permission/notification-management-manage');
const SPONSOR_PERMISSION_IDS = [PERMISSION_ID, CLIENT_READ_PERMISSION_ID, MANAGEMENT_READ_PERMISSION_ID, MANAGEMENT_PERMISSION_ID];
const CUSTOMER_PERMISSION_ID = id('permission/notification-customer-ticket-read');
const CUSTOMER_ROLE_ID = id('role/notification-customer-admin');
const LEGACY_SHARED_SPONSOR = id('tenant/oz');
const LEGACY_SPONSOR_CLIENT = id('client/oz/notification-customer');
const LEGACY_SPONSOR_BOARD = id('board/oz/notification-customer');
const LEGACY_USER_IDS = ['redacted', 'visible'].map(key => id(`user/oz/notification-${key}`));
const LEGACY_ROLE_IDS = ['redacted', 'visible'].map(key => id(`role/oz/notification-${key}`));
const LEGACY_PERMISSION_ID = id('permission/oz/notification-ticket-read');
const ROLE = Object.fromEntries(NOTIFICATION_USERS.map(user => [user.key, id(`role/notification-${user.key}`)])) as Record<(typeof NOTIFICATION_USERS)[number]['key'], string>;
const OPERATION_FINGERPRINT = fingerprint('notification-provisioning-operation');
const SMTP_PORT = Number(process.env.NOTIFICATION_SMTP_PORT || '1025');
const SMTP_HOST = process.env.NOTIFICATION_SMTP_HOST || '127.0.0.1';

async function ensureTenant(trx: Knex.Transaction, tenant: string, name: string, product: string) {
  await put(trx, 'tenants', ['tenant'], { tenant, client_name: name, email: `${tenant.slice(0, 8)}@notification.test`, product_code: product, plan: 'pro', created_at: CREATED, updated_at: CREATED });
  await put(trx, 'tenant_settings', ['tenant'], { tenant, onboarding_completed: true, onboarding_completed_at: CREATED,
    onboarding_skipped: false, settings: JSON.stringify({ timezone: 'UTC' }), created_at: CREATED, updated_at: CREATED });
}

async function credentialHash(trx: Knex.Transaction, tenant: string, userId: string, password: string, engines: FixtureEngines): Promise<string> {
  const existing = await trx('users').where({ tenant, user_id: userId }).first('hashed_password');
  if (existing?.hashed_password && await engines.verifyPassword(password, existing.hashed_password)) return existing.hashed_password;
  return engines.hashPassword(password);
}

export const notificationModule: FixtureModule = {
  name: 'notification',
  requires: [],
  async apply(trx, engines) {
    if (!SMTP_HOST.trim() || !Number.isInteger(SMTP_PORT) || SMTP_PORT < 1 || SMTP_PORT > 65535) {
      throw new Error('Notification SMTP host must be set and its port must be an integer from 1 through 65535');
    }
    await ensureTenant(trx, NOTIFICATION_CUSTOMER, 'Notification Security Customer', 'co_managed');
    await ensureTenant(trx, NOTIFICATION_SPONSOR, 'Notification Security Sponsor', 'psa');
    await put(trx, 'clients', ['tenant', 'client_id'], { tenant: NOTIFICATION_CUSTOMER, client_id: NOTIFICATION_CLIENT,
      client_name: 'Notification Security Customer', client_type: 'company', is_inactive: false, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'clients', ['tenant', 'client_id'], { tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_CLIENT,
      client_name: 'Notification Security Customer', client_type: 'company', is_inactive: false, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'clients', ['tenant', 'client_id'], { tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_HOME_CLIENT,
      client_name: 'Notification Security Sponsor', client_type: 'company', is_inactive: false, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'tenant_companies', ['tenant', 'client_id'], { tenant: NOTIFICATION_CUSTOMER, client_id: NOTIFICATION_CLIENT, is_default: true, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'tenant_companies', ['tenant', 'client_id'], { tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_HOME_CLIENT, is_default: true, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'co_managed_entitlements', ['tenant'], { tenant: NOTIFICATION_SPONSOR, source: 'admin_grant',
      source_reference: 'fixture:notification-security', capacity: 2, signed_license: null, source_version: 0,
      verified_at: CREATED, valid_until: VALID_UNTIL, lapse_started_at: null, read_only_after: null, revision: 1, updated_at: CREATED });
    await put(trx, 'boards', ['tenant', 'board_id'], { tenant: NOTIFICATION_CUSTOMER, board_id: NOTIFICATION_BOARD,
      board_name: 'Notification Security', is_inactive: false });
    await put(trx, 'boards', ['tenant', 'board_id'], { tenant: NOTIFICATION_SPONSOR, board_id: NOTIFICATION_SPONSOR_BOARD,
      board_name: 'Notification Security', is_inactive: false });
    await put(trx, 'users', ['tenant', 'user_id'], { tenant: NOTIFICATION_CUSTOMER, user_id: NOTIFICATION_CUSTOMER_ADMIN.userId,
      username: NOTIFICATION_CUSTOMER_ADMIN.email, email: NOTIFICATION_CUSTOMER_ADMIN.email, first_name: 'Customer', last_name: 'Admin',
      hashed_password: await credentialHash(trx, NOTIFICATION_CUSTOMER, NOTIFICATION_CUSTOMER_ADMIN.userId, NOTIFICATION_CUSTOMER_ADMIN.password, engines),
      user_type: 'internal', auth_method: 'password', is_inactive: false, two_factor_enabled: false, created_at: CREATED });
    await put(trx, 'permissions', ['tenant', 'permission_id'], { tenant: NOTIFICATION_CUSTOMER, permission_id: CUSTOMER_PERMISSION_ID,
      resource: 'ticket', action: 'read', msp: false, client: true });
    await put(trx, 'roles', ['tenant', 'role_id'], { tenant: NOTIFICATION_CUSTOMER, role_id: CUSTOMER_ROLE_ID,
      role_name: 'Notification Customer Admin', msp: false, client: true });
    await put(trx, 'role_permissions', ['tenant', 'role_id', 'permission_id'], { tenant: NOTIFICATION_CUSTOMER,
      role_id: CUSTOMER_ROLE_ID, permission_id: CUSTOMER_PERMISSION_ID });
    await put(trx, 'user_roles', ['tenant', 'user_id', 'role_id'], { tenant: NOTIFICATION_CUSTOMER,
      user_id: NOTIFICATION_CUSTOMER_ADMIN.userId, role_id: CUSTOMER_ROLE_ID });

    await put(trx, 'permissions', ['tenant', 'permission_id'], { tenant: NOTIFICATION_SPONSOR, permission_id: PERMISSION_ID,
      resource: 'ticket', action: 'read', msp: true, client: false });
    await put(trx, 'permissions', ['tenant', 'permission_id'], { tenant: NOTIFICATION_SPONSOR, permission_id: CLIENT_READ_PERMISSION_ID,
      resource: 'client', action: 'read', msp: true, client: false });
    await put(trx, 'permissions', ['tenant', 'permission_id'], { tenant: NOTIFICATION_SPONSOR, permission_id: MANAGEMENT_READ_PERMISSION_ID,
      resource: 'co_management', action: 'read', msp: true, client: false });
    await put(trx, 'permissions', ['tenant', 'permission_id'], { tenant: NOTIFICATION_SPONSOR, permission_id: MANAGEMENT_PERMISSION_ID,
      resource: 'co_management', action: 'manage', msp: true, client: false });
    for (const recipient of NOTIFICATION_USERS) {
      const roleId = ROLE[recipient.key];
      await put(trx, 'users', ['tenant', 'user_id'], { tenant: NOTIFICATION_SPONSOR, user_id: recipient.userId, username: recipient.email,
        email: recipient.email, first_name: recipient.name.split(' ')[0], last_name: recipient.name.split(' ')[1],
        hashed_password: await credentialHash(trx, NOTIFICATION_SPONSOR, recipient.userId, recipient.password, engines),
        user_type: 'internal', auth_method: 'password', is_inactive: false, two_factor_enabled: false, created_at: CREATED });
      await put(trx, 'roles', ['tenant', 'role_id'], { tenant: NOTIFICATION_SPONSOR, role_id: roleId,
        role_name: `Notification ${recipient.name}`, msp: true, client: false });
      await put(trx, 'role_permissions', ['tenant', 'role_id', 'permission_id'], { tenant: NOTIFICATION_SPONSOR, role_id: roleId, permission_id: PERMISSION_ID });
      for (const permissionId of SPONSOR_PERMISSION_IDS.slice(1)) {
        await put(trx, 'role_permissions', ['tenant', 'role_id', 'permission_id'], { tenant: NOTIFICATION_SPONSOR, role_id: roleId, permission_id: permissionId });
      }
      await put(trx, 'user_roles', ['tenant', 'user_id', 'role_id'], { tenant: NOTIFICATION_SPONSOR, user_id: recipient.userId, role_id: roleId });
      const policy = POLICY[recipient.key];
      await put(trx, 'authorization_bundles', ['tenant', 'bundle_id'], { tenant: NOTIFICATION_SPONSOR, bundle_id: policy.bundleId,
        bundle_key: `notification-${recipient.key}`, name: `Notification ${recipient.name} policy`, is_system: false,
        status: 'active', published_revision_id: null, created_at: CREATED, updated_at: CREATED });
      await put(trx, 'authorization_bundle_revisions', ['tenant', 'revision_id'], { tenant: NOTIFICATION_SPONSOR, revision_id: policy.revisionId,
        bundle_id: policy.bundleId, revision_number: 1, lifecycle_state: 'published', published_at: CREATED, created_at: CREATED, updated_at: CREATED });
      await put(trx, 'authorization_bundle_rules', ['tenant', 'rule_id'], { tenant: NOTIFICATION_SPONSOR, rule_id: policy.ruleId, bundle_id: policy.bundleId,
        revision_id: policy.revisionId, resource_type: 'ticket', action: 'read', template_key: 'selected_clients',
        effect: 'narrow', constraint_key: null, config: JSON.stringify({ selectedClientIds: [NOTIFICATION_SPONSOR_CLIENT], redactedFields: recipient.hidden }), position: 0, created_at: CREATED, updated_at: CREATED });
      await trx('authorization_bundles').where({ tenant: NOTIFICATION_SPONSOR, bundle_id: policy.bundleId }).update({ published_revision_id: policy.revisionId });
      await put(trx, 'authorization_bundle_assignments', ['tenant', 'assignment_id'], { tenant: NOTIFICATION_SPONSOR, assignment_id: policy.assignmentId,
        bundle_id: policy.bundleId, target_type: 'user', target_id: recipient.userId, status: 'active', created_at: CREATED, updated_at: CREATED });
      await put(trx, 'co_management_staff_assignments', ['tenant', 'customer_tenant', 'relationship_id', 'principal_type', 'principal_id'], {
        tenant: NOTIFICATION_SPONSOR, customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP,
        principal_type: 'user', principal_id: recipient.userId, relationship_role: 'technician', created_at: CREATED });
    }
    await ensure(trx, 'tenant_email_settings', { tenant: NOTIFICATION_SPONSOR }, { email_provider: 'smtp',
      default_from_domain: 'notification.test', ticketing_from_email: 'agent@notification.test', fallback_enabled: false,
      tracking_enabled: false, provider_configs: JSON.stringify([{ providerId: 'notification-local-smtp', providerType: 'smtp', isEnabled: true,
        config: { host: SMTP_HOST, port: SMTP_PORT, secure: false,
          rejectUnauthorized: false, from: 'agent@notification.test' } }]) });

    await put(trx, 'co_management_relationships', ['tenant', 'relationship_id'], { tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP, sponsor_tenant: NOTIFICATION_SPONSOR, sponsor_client_id: NOTIFICATION_SPONSOR_CLIENT,
      state: 'active', visibility_mode: 'escalation_only', revision: 1, accepted_by: NOTIFICATION_CUSTOMER_ADMIN.userId,
      accepted_at: CREATED, created_at: CREATED, updated_at: CREATED });
    await put(trx, 'tickets', ['tenant', 'ticket_id'], { tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET,
      ticket_number: 'NOTIFY-001', title: 'Fixture restricted title', client_id: NOTIFICATION_CLIENT, board_id: NOTIFICATION_BOARD,
      entered_by: NOTIFICATION_CUSTOMER_ADMIN.userId, entered_at: CREATED, updated_at: CREATED, is_closed: false });
    await put(trx, 'co_management_ticket_work', ['tenant', 'relationship_id', 'ticket_id'], { tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP, ticket_id: NOTIFICATION_TICKET, work_id: NOTIFICATION_WORK, revision: 1,
      responsibility: 'msp', can_collaborate: true, first_escalated_at: CREATED, last_transition_at: CREATED });
    await put(trx, 'co_managed_ticket_references', ['tenant', 'reference_id'], { tenant: NOTIFICATION_SPONSOR, reference_id: NOTIFICATION_REFERENCE,
      customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, ticket_id: NOTIFICATION_TICKET,
      work_id: NOTIFICATION_WORK, client_id: NOTIFICATION_SPONSOR_CLIENT, board_id: NOTIFICATION_SPONSOR_BOARD,
      assigned_to: NOTIFICATION_USERS[0].userId, created_at: CREATED, updated_at: CREATED });
    const request = { clientId: NOTIFICATION_SPONSOR_CLIENT, workspaceName: 'Notification Security Customer',
      administrator: { firstName: 'Customer', lastName: 'Admin', email: NOTIFICATION_CUSTOMER_ADMIN.email },
      seats: 2, visibilityMode: 'escalation_only', escalationBoardId: NOTIFICATION_SPONSOR_BOARD };
    await put(trx, 'co_managed_provisioning_operations', ['tenant', 'operation_id'], { tenant: NOTIFICATION_SPONSOR,
      operation_id: NOTIFICATION_OPERATION, allocation_id: NOTIFICATION_ALLOCATION, customer_tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP, requested_by: NOTIFICATION_USERS[0].userId,
      escalation_board_id: NOTIFICATION_SPONSOR_BOARD, customer_board_id: NOTIFICATION_BOARD,
      customer_client_id: NOTIFICATION_CLIENT, administrator_invitation_id: NOTIFICATION_INVITATION,
      request_fingerprint: OPERATION_FINGERPRINT, request: JSON.stringify(request), state: 'pending_acceptance', step: null,
      created_at: CREATED, updated_at: CREATED });
    await put(trx, 'co_managed_allocations', ['tenant', 'allocation_id'], { tenant: NOTIFICATION_SPONSOR,
      allocation_id: NOTIFICATION_ALLOCATION, operation_id: NOTIFICATION_OPERATION,
      request_fingerprint: OPERATION_FINGERPRINT, customer_tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP, seats: 2, state: 'active', released_at: null,
      created_at: CREATED, updated_at: CREATED });
  },
  async verify(db, engines) {
    const customer = await db('tenants').where({ tenant: NOTIFICATION_CUSTOMER, product_code: 'co_managed' }).first('tenant');
    const sponsor = await db('tenants').where({ tenant: NOTIFICATION_SPONSOR, product_code: 'psa' }).first('tenant');
    const customerCompany = await db('tenant_companies').where({ tenant: NOTIFICATION_CUSTOMER, client_id: NOTIFICATION_CLIENT, is_default: true }).first();
    const sponsorCompany = await db('tenant_companies').where({ tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_HOME_CLIENT, is_default: true }).first();
    const relationship = await db('co_management_relationships').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP,
      sponsor_tenant: NOTIFICATION_SPONSOR, state: 'active' }).first('relationship_id');
    const ticket = await db('tickets').where({ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }).first('ticket_id');
    const work = await db('co_management_ticket_work').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, ticket_id: NOTIFICATION_TICKET }).first('work_id');
    const operation = await db('co_managed_provisioning_operations').where({ tenant: NOTIFICATION_SPONSOR, operation_id: NOTIFICATION_OPERATION,
      customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).first();
    const allocation = await db('co_managed_allocations').where({ tenant: NOTIFICATION_SPONSOR, allocation_id: NOTIFICATION_ALLOCATION,
      operation_id: NOTIFICATION_OPERATION, customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP, state: 'active' }).first();
    const entitlement = await db('co_managed_entitlements').where({ tenant: NOTIFICATION_SPONSOR, source: 'admin_grant' }).first('capacity');
    const smtp = await db('tenant_email_settings').where({ tenant: NOTIFICATION_SPONSOR, email_provider: 'smtp' }).first('provider_configs');
    let smtpReady = false;
    try {
      const config = typeof smtp?.provider_configs === 'string' ? JSON.parse(smtp.provider_configs) : smtp?.provider_configs;
      smtpReady = config?.some((provider: any) => provider.providerType === 'smtp' && provider.isEnabled &&
        typeof provider.config?.host === 'string' && provider.config.host.trim().length > 0 &&
        Number.isInteger(Number(provider.config?.port)) && Number(provider.config.port) > 0 && Number(provider.config.port) <= 65535);
    } catch { smtpReady = false; }
    const reports: VerifyReport[] = [
      { ok: Boolean(customer && sponsor), area: 'notification', detail: 'fixture-owned customer and sponsor workspaces exist' },
      { ok: Boolean(customerCompany && sponsorCompany), area: 'notification', detail: 'both fixture workspaces have a default company for UI context' },
      { ok: Boolean(relationship && ticket && work), area: 'notification', detail: 'active relationship and escalated shared ticket exist' },
      { ok: Boolean(operation && operation.request?.clientId === NOTIFICATION_SPONSOR_CLIENT && operation.escalation_board_id === NOTIFICATION_SPONSOR_BOARD), area: 'notification', detail: 'provisioning operation resolves to the fixture sponsor client and board' },
      { ok: Boolean(allocation?.state === 'active'), area: 'notification', detail: 'active sponsor allocation exists for the operation and relationship' },
      { ok: Number(entitlement?.capacity ?? 0) >= 2, area: 'notification', detail: 'fixture sponsor has capacity for the active allocation' },
      { ok: Boolean(smtpReady), area: 'notification', detail: 'fixture sponsor has enabled local SMTP configuration' },
    ];
    for (const recipient of NOTIFICATION_USERS) {
      const user = await db('users').where({ tenant: NOTIFICATION_SPONSOR, user_id: recipient.userId, user_type: 'internal', is_inactive: false }).first();
      const role = await db('roles').where({ tenant: NOTIFICATION_SPONSOR, role_id: ROLE[recipient.key] }).first('role_id');
      const membership = await db('user_roles').where({ tenant: NOTIFICATION_SPONSOR, user_id: recipient.userId, role_id: ROLE[recipient.key] }).first();
      const permission = await db('role_permissions').where({ tenant: NOTIFICATION_SPONSOR, role_id: ROLE[recipient.key], permission_id: PERMISSION_ID }).first();
      const clientPermission = await db('role_permissions').where({ tenant: NOTIFICATION_SPONSOR, role_id: ROLE[recipient.key], permission_id: CLIENT_READ_PERMISSION_ID }).first();
      const managementReadPermission = await db('role_permissions').where({ tenant: NOTIFICATION_SPONSOR, role_id: ROLE[recipient.key], permission_id: MANAGEMENT_READ_PERMISSION_ID }).first();
      const managementPermission = await db('role_permissions').where({ tenant: NOTIFICATION_SPONSOR, role_id: ROLE[recipient.key], permission_id: MANAGEMENT_PERMISSION_ID }).first();
      const staff = await db('co_management_staff_assignments').where({ tenant: NOTIFICATION_SPONSOR, customer_tenant: NOTIFICATION_CUSTOMER,
        relationship_id: NOTIFICATION_RELATIONSHIP, principal_type: 'user', principal_id: recipient.userId }).first();
      const assignment = await db('authorization_bundle_assignments').where({ tenant: NOTIFICATION_SPONSOR,
        assignment_id: POLICY[recipient.key].assignmentId, target_id: recipient.userId, status: 'active' }).first();
      const rule = await db('authorization_bundle_rules').where({ tenant: NOTIFICATION_SPONSOR, rule_id: POLICY[recipient.key].ruleId }).first();
      let credentialValid = Boolean(engines && user?.hashed_password && !String(user.hashed_password).includes('fixture-only'));
      if (credentialValid && user) credentialValid = await engines!.verifyPassword(recipient.password, user.hashed_password);
      reports.push({ ok: Boolean(credentialValid), area: 'notification', detail: `${recipient.key} recipient password is accepted by the application verifier` });
      reports.push({ ok: Boolean(role && membership && permission && clientPermission && managementReadPermission && managementPermission), area: 'notification', detail: `${recipient.key} recipient has required internal ticket, client, and co-management permissions` });
      reports.push({ ok: Boolean(staff), area: 'notification', detail: `${recipient.key} recipient is assigned to the fixture relationship` });
      reports.push({ ok: Boolean(assignment && rule && JSON.stringify(rule.config?.redactedFields ?? []) === JSON.stringify(recipient.hidden)), area: 'notification', detail: `${recipient.key} recipient-specific read redaction policy exists` });
    }
    const customerUser = await db('users').where({ tenant: NOTIFICATION_CUSTOMER, user_id: NOTIFICATION_CUSTOMER_ADMIN.userId, user_type: 'internal', is_inactive: false }).first();
    const customerRole = await db('user_roles').where({ tenant: NOTIFICATION_CUSTOMER, user_id: NOTIFICATION_CUSTOMER_ADMIN.userId, role_id: CUSTOMER_ROLE_ID }).first();
    let customerCredentialValid = Boolean(engines && customerUser?.hashed_password && !String(customerUser.hashed_password).includes('fixture-only'));
    if (customerCredentialValid && customerUser) customerCredentialValid = await engines!.verifyPassword(NOTIFICATION_CUSTOMER_ADMIN.password, customerUser.hashed_password);
    reports.push({ ok: Boolean(customerCredentialValid), area: 'notification', detail: 'fixture customer admin password is accepted by the application verifier' });
    reports.push({ ok: Boolean(customerRole), area: 'notification', detail: 'fixture customer admin has role membership' });
    return reports;
  },
  async reset(trx) {
    await trx('co_management_deliveries').where({ tenant: NOTIFICATION_CUSTOMER, source_id: id('source/notification-routing-recovery') }).delete();
    await trx('co_managed_allocations').where({ tenant: NOTIFICATION_SPONSOR, allocation_id: NOTIFICATION_ALLOCATION }).delete();
    await trx('co_managed_entitlements').where({ tenant: NOTIFICATION_SPONSOR, source_reference: 'fixture:notification-security' }).delete();
    await trx('co_managed_provisioning_operations').where({ tenant: NOTIFICATION_SPONSOR, operation_id: NOTIFICATION_OPERATION }).delete();
    await trx('co_managed_ticket_references').where({ tenant: NOTIFICATION_SPONSOR, reference_id: NOTIFICATION_REFERENCE }).delete();
    await trx('co_management_command_receipts').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP,
      resource_type: 'ticket', resource_id: NOTIFICATION_TICKET }).delete();
    await trx('co_management_ticket_work').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('co_management_staff_assignments').where({ tenant: NOTIFICATION_SPONSOR, customer_tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('co_management_board_scopes').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('co_management_relationships').where({ tenant: NOTIFICATION_CUSTOMER, relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('ticket_comment_attachments').where({ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }).delete();
    await trx('email_reply_tokens').where({ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }).delete();
    const comments = await trx('comments').where({ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }).select('comment_id');
    const commentIds = comments.map((comment: { comment_id: string }) => comment.comment_id);
    if (commentIds.length) {
      await trx('ticket_comment_email_deliveries').where({ tenant: NOTIFICATION_CUSTOMER }).whereIn('comment_id', commentIds).delete();
      await trx('comments').where({ tenant: NOTIFICATION_CUSTOMER }).whereIn('comment_id', commentIds).delete();
    }
    await trx('ticket_audit_logs').where({ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }).delete();
    await trx('tickets').where({ tenant: NOTIFICATION_CUSTOMER, ticket_id: NOTIFICATION_TICKET }).delete();
    await trx('authorization_bundle_assignments').whereIn('assignment_id', NOTIFICATION_USERS.map(user => POLICY[user.key].assignmentId)).andWhere({ tenant: NOTIFICATION_SPONSOR }).delete();
    await trx('authorization_bundle_rules').whereIn('rule_id', NOTIFICATION_USERS.map(user => POLICY[user.key].ruleId)).andWhere({ tenant: NOTIFICATION_SPONSOR }).delete();
    await trx('authorization_bundles').whereIn('bundle_id', NOTIFICATION_USERS.map(user => POLICY[user.key].bundleId)).andWhere({ tenant: NOTIFICATION_SPONSOR }).update({ published_revision_id: null });
    await trx('authorization_bundle_revisions').whereIn('revision_id', NOTIFICATION_USERS.map(user => POLICY[user.key].revisionId)).andWhere({ tenant: NOTIFICATION_SPONSOR }).delete();
    await trx('authorization_bundles').whereIn('bundle_id', NOTIFICATION_USERS.map(user => POLICY[user.key].bundleId)).andWhere({ tenant: NOTIFICATION_SPONSOR }).delete();
    await trx('tenant_email_settings').where({ tenant: NOTIFICATION_SPONSOR }).delete();
    for (const user of NOTIFICATION_USERS) {
      await trx('user_roles').where({ tenant: NOTIFICATION_SPONSOR, user_id: user.userId }).delete();
      await trx('users').where({ tenant: NOTIFICATION_SPONSOR, user_id: user.userId }).delete();
    }
    await trx('role_permissions').whereIn('permission_id', SPONSOR_PERMISSION_IDS).andWhere({ tenant: NOTIFICATION_SPONSOR }).delete();
    await trx('roles').whereIn('role_id', NOTIFICATION_USERS.map(user => ROLE[user.key])).andWhere({ tenant: NOTIFICATION_SPONSOR }).delete();
    await trx('permissions').whereIn('permission_id', SPONSOR_PERMISSION_IDS).andWhere({ tenant: NOTIFICATION_SPONSOR }).delete();
    await trx('user_roles').where({ tenant: NOTIFICATION_CUSTOMER, user_id: NOTIFICATION_CUSTOMER_ADMIN.userId, role_id: CUSTOMER_ROLE_ID }).delete();
    await trx('role_permissions').where({ tenant: NOTIFICATION_CUSTOMER, role_id: CUSTOMER_ROLE_ID, permission_id: CUSTOMER_PERMISSION_ID }).delete();
    await trx('roles').where({ tenant: NOTIFICATION_CUSTOMER, role_id: CUSTOMER_ROLE_ID }).delete();
    await trx('permissions').where({ tenant: NOTIFICATION_CUSTOMER, permission_id: CUSTOMER_PERMISSION_ID }).delete();
    await trx('users').where({ tenant: NOTIFICATION_CUSTOMER, user_id: NOTIFICATION_CUSTOMER_ADMIN.userId }).delete();
    await trx('boards').where({ tenant: NOTIFICATION_CUSTOMER, board_id: NOTIFICATION_BOARD }).delete();
    await trx('boards').where({ tenant: NOTIFICATION_SPONSOR, board_id: NOTIFICATION_SPONSOR_BOARD }).delete();
    await trx('client_billing_profiles').where({ tenant: NOTIFICATION_CUSTOMER, client_id: NOTIFICATION_CLIENT }).delete();
    await trx('client_billing_profiles').where({ tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_CLIENT }).delete();
    await trx('client_billing_profiles').where({ tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_HOME_CLIENT }).delete();
    await trx('clients').where({ tenant: NOTIFICATION_CUSTOMER, client_id: NOTIFICATION_CLIENT }).delete();
    await trx('clients').where({ tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_CLIENT }).delete();
    await trx('clients').where({ tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_HOME_CLIENT }).delete();
    await trx('tenant_settings').whereIn('tenant', [NOTIFICATION_CUSTOMER, NOTIFICATION_SPONSOR]).delete();
    await trx('tenant_companies').where({ tenant: NOTIFICATION_CUSTOMER, client_id: NOTIFICATION_CLIENT }).delete();
    await trx('tenant_companies').where({ tenant: NOTIFICATION_SPONSOR, client_id: NOTIFICATION_SPONSOR_HOME_CLIENT }).delete();
    await trx('tenants').whereIn('tenant', [NOTIFICATION_CUSTOMER, NOTIFICATION_SPONSOR]).delete();
    // Retire only the exact notification-card rows written by the earlier
    // fixture version in the shared Oz tenant. No shared policy or QA identity
    // outside these stable card IDs is touched.
    await trx('co_managed_ticket_references').where({ tenant: LEGACY_SHARED_SPONSOR, reference_id: NOTIFICATION_REFERENCE }).delete();
    await trx('co_management_staff_assignments').where({ tenant: LEGACY_SHARED_SPONSOR, customer_tenant: NOTIFICATION_CUSTOMER,
      relationship_id: NOTIFICATION_RELATIONSHIP }).delete();
    await trx('authorization_bundle_assignments').whereIn('assignment_id', NOTIFICATION_USERS.map(user => POLICY[user.key].assignmentId)).andWhere({ tenant: LEGACY_SHARED_SPONSOR }).delete();
    await trx('authorization_bundle_rules').whereIn('rule_id', NOTIFICATION_USERS.map(user => POLICY[user.key].ruleId)).andWhere({ tenant: LEGACY_SHARED_SPONSOR }).delete();
    await trx('authorization_bundles').whereIn('bundle_id', NOTIFICATION_USERS.map(user => POLICY[user.key].bundleId)).andWhere({ tenant: LEGACY_SHARED_SPONSOR }).update({ published_revision_id: null });
    await trx('authorization_bundle_revisions').whereIn('revision_id', NOTIFICATION_USERS.map(user => POLICY[user.key].revisionId)).andWhere({ tenant: LEGACY_SHARED_SPONSOR }).delete();
    await trx('authorization_bundles').whereIn('bundle_id', NOTIFICATION_USERS.map(user => POLICY[user.key].bundleId)).andWhere({ tenant: LEGACY_SHARED_SPONSOR }).delete();
    for (const userId of LEGACY_USER_IDS) {
      await trx('user_roles').where({ tenant: LEGACY_SHARED_SPONSOR, user_id: userId }).delete();
      await trx('users').where({ tenant: LEGACY_SHARED_SPONSOR, user_id: userId }).delete();
    }
    await trx('role_permissions').where({ tenant: LEGACY_SHARED_SPONSOR, permission_id: LEGACY_PERMISSION_ID }).delete();
    await trx('roles').whereIn('role_id', LEGACY_ROLE_IDS).andWhere({ tenant: LEGACY_SHARED_SPONSOR }).delete();
    await trx('permissions').where({ tenant: LEGACY_SHARED_SPONSOR, permission_id: LEGACY_PERMISSION_ID }).delete();
    await trx('boards').where({ tenant: LEGACY_SHARED_SPONSOR, board_id: LEGACY_SPONSOR_BOARD }).delete();
    await trx('client_billing_profiles').where({ tenant: LEGACY_SHARED_SPONSOR, client_id: LEGACY_SPONSOR_CLIENT }).delete();
    await trx('clients').where({ tenant: LEGACY_SHARED_SPONSOR, client_id: LEGACY_SPONSOR_CLIENT }).delete();
  },
};
