#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAdminConnection } from '@alga-psa/db/admin';
import { hashPassword, verifyPassword } from '@alga-psa/core/encryption';
import { hasPermission } from '@alga-psa/auth/rbac';
import { authenticateUser } from '../../packages/auth/src/actions/auth';
import type { Knex } from 'knex';

const FIXTURE_EMAIL = 'invoice-authz-linked-internal@example.invalid';
const FIXTURE_USERNAME = 'invoice-authz-linked-internal';
const FIXTURE_ROLE = 'invoice_email_authz_linked_internal_fixture';
const FIXTURE_DESCRIPTION = 'Managed by server/scripts/invoiceEmailAuthzLinkedInternalFixture.ts';
const PERMISSIONS = [
  { resource: 'billing', action: 'read' },
  { resource: 'billing', action: 'create' },
] as const;

interface FixtureInput {
  tenant: string;
  invoiceNumber: string;
  contactId: string;
  passwordFile?: string;
}

interface FixtureContext {
  invoiceId: string;
  clientId: string;
  contactId: string;
  clientName: string;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function loadInput(): FixtureInput {
  return {
    tenant: required(process.env.INVOICE_AUTHZ_FIXTURE_TENANT, 'INVOICE_AUTHZ_FIXTURE_TENANT'),
    invoiceNumber: process.env.INVOICE_AUTHZ_FIXTURE_INVOICE?.trim() || 'SMOKE-AUTHZ-1102',
    contactId: required(process.env.INVOICE_AUTHZ_FIXTURE_CONTACT_ID, 'INVOICE_AUTHZ_FIXTURE_CONTACT_ID'),
    passwordFile: process.env.INVOICE_AUTHZ_FIXTURE_PASSWORD_FILE,
  };
}

function assertLocalSmokeDatabase(): void {
  const host = process.env.DB_HOST_ADMIN || process.env.DB_HOST;
  const database = process.env.DB_NAME_SERVER || process.env.DB_NAME || 'server';
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(host || '') || database !== 'server') {
    throw new Error('Fixture writes are restricted to the local server database.');
  }
  if (process.env.INVOICE_AUTHZ_FIXTURE_CONFIRM !== 'local-smoke-db') {
    throw new Error('Set INVOICE_AUTHZ_FIXTURE_CONFIRM=local-smoke-db to confirm this local fixture database.');
  }
}

async function readPassword(passwordFile: string | undefined): Promise<string> {
  const configured = required(passwordFile, 'INVOICE_AUTHZ_FIXTURE_PASSWORD_FILE');
  const password = (await readFile(path.resolve(configured), 'utf8')).trim();
  if (password.length < 16) throw new Error('Fixture password must contain at least 16 characters.');
  return password;
}

async function resolveFixtureContext(
  db: Knex | Knex.Transaction,
  input: FixtureInput,
): Promise<FixtureContext> {
  const invoices = await db('invoices as i')
    .join('clients as c', function joinClient() {
      this.on('c.tenant', '=', 'i.tenant').andOn('c.client_id', '=', 'i.client_id');
    })
    .where({ 'i.tenant': input.tenant, 'i.invoice_number': input.invoiceNumber })
    .select('i.invoice_id', 'i.client_id', 'i.status', 'c.client_name');
  if (invoices.length !== 1) throw new Error('Expected exactly one controlled invoice in the selected tenant.');
  const invoice = invoices[0];
  if (invoice.status === 'draft') throw new Error('The controlled invoice must be issued, not draft.');

  const contact = await db('contacts')
    .where({ tenant: input.tenant, contact_name_id: input.contactId, client_id: invoice.client_id })
    .first('contact_name_id');
  if (!contact) throw new Error('The selected contact does not belong to the controlled invoice owner.');

  return {
    invoiceId: invoice.invoice_id,
    clientId: invoice.client_id,
    contactId: contact.contact_name_id,
    clientName: invoice.client_name,
  };
}

async function readClientAccounts(db: Knex | Knex.Transaction, input: FixtureInput, context: FixtureContext) {
  return db('users')
    .where({ tenant: input.tenant, contact_id: context.contactId })
    .select('user_id', 'email', 'username', 'user_type', 'contact_id', 'is_inactive')
    .orderBy('user_id');
}

async function readClientRecord(db: Knex | Knex.Transaction, input: FixtureInput, context: FixtureContext) {
  return db('clients').where({ tenant: input.tenant, client_id: context.clientId })
    .first('client_id', 'client_name', 'billing_email', 'billing_contact_id', 'is_inactive');
}

async function ensureFixtureRole(trx: Knex.Transaction, tenant: string): Promise<string> {
  const matches = await trx('roles').where({ tenant, role_name: FIXTURE_ROLE }).select('*');
  if (matches.length > 1) throw new Error('Fixture role name is ambiguous in this tenant.');
  if (matches.length === 1) {
    const role = matches[0];
    if (role.description !== FIXTURE_DESCRIPTION || role.msp !== true || role.client !== false) {
      throw new Error('A non-fixture role uses the reserved fixture role name; refusing to modify it.');
    }
    return role.role_id;
  }

  const [role] = await trx('roles').insert({
    tenant,
    role_name: FIXTURE_ROLE,
    description: FIXTURE_DESCRIPTION,
    msp: true,
    client: false,
  }).returning('role_id');
  return role.role_id;
}

async function ensureFixturePermissions(trx: Knex.Transaction, tenant: string, roleId: string): Promise<void> {
  for (const permission of PERMISSIONS) {
    const rows = await trx('permissions')
      .where({ tenant, ...permission, msp: true })
      .select('permission_id');
    if (rows.length !== 1) {
      throw new Error(`Expected one MSP ${permission.resource}:${permission.action} permission in this tenant.`);
    }
    await trx('role_permissions').insert({
      tenant,
      role_id: roleId,
      permission_id: rows[0].permission_id,
    }).onConflict(['tenant', 'role_id', 'permission_id']).ignore();
  }
}

async function setup(db: Knex, input: FixtureInput, password: string): Promise<void> {
  const context = await resolveFixtureContext(db, input);
  const passwordHash = await hashPassword(password);
  if (!await verifyPassword(password, passwordHash)) throw new Error('Application password hash did not verify.');

  const clientAccountsBefore = await readClientAccounts(db, input, context);
  const clientRecordBefore = await readClientRecord(db, input, context);
  if (!clientRecordBefore) throw new Error('The controlled invoice owner client disappeared before fixture setup.');
  const existingIdentity = await db('users').where({ email: FIXTURE_EMAIL }).select('tenant', 'user_id', 'user_type');
  if (existingIdentity.some((user) => user.tenant !== input.tenant)) {
    throw new Error('Reserved fixture login is already used by another tenant.');
  }
  if (existingIdentity.some((user) => user.user_type !== 'internal')) {
    throw new Error('Reserved fixture login belongs to a non-internal user; refusing to alter it.');
  }

  const userId = await db.transaction(async (trx) => {
    const roleId = await ensureFixtureRole(trx, input.tenant);
    await ensureFixturePermissions(trx, input.tenant, roleId);

    const existing = await trx('users')
      .where({ tenant: input.tenant, email: FIXTURE_EMAIL })
      .forUpdate()
      .first('user_id', 'user_type', 'contact_id');
    let targetUserId: string;
    if (existing) {
      const assignedRoles = await trx('user_roles')
        .where({ tenant: input.tenant, user_id: existing.user_id })
        .select('role_id');
      if (existing.user_type !== 'internal' || existing.contact_id !== context.contactId ||
          assignedRoles.some((assignment) => assignment.role_id !== roleId)) {
        throw new Error('Existing reserved fixture identity does not match the managed fixture; refusing to overwrite it.');
      }
      targetUserId = existing.user_id;
      await trx('users').where({ tenant: input.tenant, user_id: targetUserId }).update({
        username: FIXTURE_USERNAME,
        first_name: 'Invoice Authz',
        last_name: 'Smoke Internal',
        user_type: 'internal',
        contact_id: context.contactId,
        is_inactive: false,
        hashed_password: passwordHash,
        auth_method: 'password',
        is_google_user: false,
        two_factor_enabled: false,
        updated_at: trx.fn.now(),
      });
    } else {
      const [inserted] = await trx('users').insert({
        tenant: input.tenant,
        username: FIXTURE_USERNAME,
        email: FIXTURE_EMAIL,
        first_name: 'Invoice Authz',
        last_name: 'Smoke Internal',
        user_type: 'internal',
        contact_id: context.contactId,
        is_inactive: false,
        hashed_password: passwordHash,
        auth_method: 'password',
        is_google_user: false,
        two_factor_enabled: false,
      }).returning('user_id');
      targetUserId = inserted.user_id;
    }

    await trx('user_roles').insert({ tenant: input.tenant, user_id: targetUserId, role_id: roleId })
      .onConflict(['tenant', 'user_id', 'role_id']).ignore();
    return targetUserId;
  });

  await assertFixture(db, input, password, context, userId, clientAccountsBefore, clientRecordBefore);
}

async function assertFixture(
  db: Knex,
  input: FixtureInput,
  password: string,
  context?: FixtureContext,
  expectedUserId?: string,
  expectedClientAccounts?: unknown,
  expectedClientRecord?: unknown,
): Promise<void> {
  const resolvedContext = context ?? await resolveFixtureContext(db, input);
  const clientAccountsBefore = expectedClientAccounts ?? await readClientAccounts(db, input, resolvedContext);
  const user = await db('users').where({ tenant: input.tenant, email: FIXTURE_EMAIL })
    .first('user_id', 'tenant', 'email', 'username', 'user_type', 'contact_id', 'is_inactive', 'auth_method', 'hashed_password');
  if (!user || (expectedUserId && user.user_id !== expectedUserId) || user.user_type !== 'internal' ||
      user.contact_id !== resolvedContext.contactId || user.is_inactive || user.auth_method !== 'password' ||
      !await verifyPassword(password, user.hashed_password)) {
    throw new Error('Persisted fixture identity, active state, contact link, or password verification failed.');
  }

  const userRoles = await db('user_roles as ur')
    .join('roles as r', function joinRole() {
      this.on('r.tenant', '=', 'ur.tenant').andOn('r.role_id', '=', 'ur.role_id');
    })
    .where({ 'ur.tenant': input.tenant, 'ur.user_id': user.user_id })
    .select('r.role_name', 'r.msp', 'r.client', 'r.description');
  if (userRoles.length !== 1 || userRoles[0].role_name !== FIXTURE_ROLE || userRoles[0].msp !== true ||
      userRoles[0].client !== false || userRoles[0].description !== FIXTURE_DESCRIPTION) {
    throw new Error('Fixture must have only its dedicated MSP role.');
  }

  const permissionResults = Object.fromEntries(await Promise.all([
    ...PERMISSIONS.map(async ({ resource, action }) => [
      `${resource}:${action}`,
      await hasPermission({ ...user, roles: [] }, resource, action, db),
    ] as const),
    (async () => ['invoice:send', await hasPermission({ ...user, roles: [] }, 'invoice', 'send', db)] as const)(),
  ]));
  if (permissionResults['billing:read'] !== true || permissionResults['billing:create'] !== true ||
      permissionResults['invoice:send'] !== false) {
    throw new Error('Fixture permissions must grant billing read/create and deny invoice send.');
  }

  const authenticated = await authenticateUser(FIXTURE_EMAIL, password, 'internal', {
    tenantId: input.tenant,
    requireTenantMatch: true,
  });
  if (!authenticated || authenticated.user_id !== user.user_id || authenticated.user_type !== 'internal' ||
      authenticated.contact_id !== resolvedContext.contactId) {
    throw new Error('Application authenticateUser did not return the persisted internal linked-contact fixture.');
  }

  const clientAccountsAfter = await readClientAccounts(db, input, resolvedContext);
  if (JSON.stringify(clientAccountsBefore) !== JSON.stringify(clientAccountsAfter)) {
    throw new Error('Existing user rows linked to this contact changed during fixture setup.');
  }
  const clientRecordAfter = await readClientRecord(db, input, resolvedContext);
  if (!clientRecordAfter || (expectedClientRecord !== undefined &&
      JSON.stringify(expectedClientRecord) !== JSON.stringify(clientRecordAfter))) {
    throw new Error('The controlled invoice owner client record changed during fixture setup.');
  }

  console.log(JSON.stringify({
    status: 'verified',
    userId: user.user_id,
    userType: user.user_type,
    active: true,
    loginReady: true,
    invoiceNumber: input.invoiceNumber,
    invoiceId: resolvedContext.invoiceId,
    clientId: resolvedContext.clientId,
    contactId: resolvedContext.contactId,
    clientAccountBaselineCompared: expectedClientRecord !== undefined,
    clientPortalUsersBaselineCompared: expectedClientAccounts !== undefined,
    permissions: permissionResults,
  }));
}

async function cleanup(db: Knex, input: FixtureInput): Promise<void> {
  const context = await resolveFixtureContext(db, input);
  const user = await db('users').where({ tenant: input.tenant, email: FIXTURE_EMAIL })
    .first('user_id', 'user_type', 'contact_id');
  const roles = await db('roles').where({ tenant: input.tenant, role_name: FIXTURE_ROLE })
    .select('role_id', 'description', 'msp', 'client');
  if (!user && roles.length === 0) {
    console.log(JSON.stringify({ status: 'already-clean', clientAccountsPreserved: true }));
    return;
  }
  if (!user || user.user_type !== 'internal' || user.contact_id !== context.contactId || roles.length !== 1 ||
      roles[0].description !== FIXTURE_DESCRIPTION || roles[0].msp !== true || roles[0].client !== false) {
    throw new Error('Cleanup safety check failed; the reserved fixture no longer matches its managed identity.');
  }

  await db.transaction(async (trx) => {
    const otherUsers = await trx('user_roles')
      .where({ tenant: input.tenant, role_id: roles[0].role_id })
      .whereNot('user_id', user.user_id)
      .count('* as count')
      .first();
    if (Number(otherUsers?.count ?? 0) > 0) throw new Error('Fixture role is assigned to another user; refusing cleanup.');

    await trx('sessions').where({ tenant: input.tenant, user_id: user.user_id }).delete();
    await trx('user_roles').where({ tenant: input.tenant, user_id: user.user_id }).delete();
    await trx('role_permissions').where({ tenant: input.tenant, role_id: roles[0].role_id }).delete();
    await trx('users').where({ tenant: input.tenant, user_id: user.user_id, user_type: 'internal' }).delete();
    await trx('roles').where({ tenant: input.tenant, role_id: roles[0].role_id }).delete();
  });

  const remainingFixture = await db('users').where({ tenant: input.tenant, email: FIXTURE_EMAIL }).first('user_id');
  const remainingRole = await db('roles').where({ tenant: input.tenant, role_name: FIXTURE_ROLE }).first('role_id');
  if (remainingFixture || remainingRole) throw new Error('Fixture cleanup did not remove its dedicated records.');
  const clientAccounts = await readClientAccounts(db, input, context);
  console.log(JSON.stringify({ status: 'cleaned', clientAccountsPreserved: true, clientAccountCount: clientAccounts.length }));
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (!['setup', 'check', 'cleanup'].includes(operation)) {
    throw new Error('Usage: invoiceEmailAuthzLinkedInternalFixture.ts <setup|check|cleanup>');
  }
  if (operation !== 'check') assertLocalSmokeDatabase();
  const input = loadInput();
  const password = operation === 'cleanup' ? undefined : await readPassword(input.passwordFile);
  const db = await getAdminConnection();
  try {
    const context = await resolveFixtureContext(db, input);
    if (operation === 'setup') await setup(db, input, password!);
    else if (operation === 'check') await assertFixture(db, input, password!, context);
    else await cleanup(db, input);
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Fixture operation failed.');
  process.exitCode = 1;
});
