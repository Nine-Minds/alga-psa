import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { hashPassword } from '@alga-psa/shared/utils/encryption.js';
import { generateTemporaryPassword as generatePassword } from './email-activities.js';
import { sendWelcomeEmail as sendEmail } from './email-activities.js';
import type { SendWelcomeEmailActivityInput } from '../types/workflow-types.js';

const logger = () => Context.current().log;

export interface AuditEventInput {
  tenantId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  triggeredBy: string;
  triggeredByEmail: string;
  details: Record<string, any>;
}

export async function getTenant(tenantId: string) {
  const log = logger();
  log.info('Getting tenant', { tenantId });

  const knex = await getAdminConnection();
  return knex('tenants').where({ tenant: tenantId }).first();
}

export async function getUser(userId: string, tenantId: string) {
  const log = logger();
  log.info('Getting user', { userId, tenantId });

  const knex = await getAdminConnection();
  return knex('users').where({ user_id: userId, tenant: tenantId }).first();
}

export async function findAdminUser(tenantId: string) {
  const log = logger();
  log.info('Finding admin user for tenant', { tenantId });

  const knex = await getAdminConnection();
  const user = await knex('users as u')
    .join('user_roles as ur', function () {
      this.on('u.user_id', '=', 'ur.user_id').andOn('u.tenant', '=', 'ur.tenant');
    })
    .join('roles as r', function () {
      this.on('ur.role_id', '=', 'r.role_id').andOn('ur.tenant', '=', 'r.tenant');
    })
    .where({
      'u.tenant': tenantId,
      'r.role_name': 'Admin',
      'u.is_inactive': false,
    })
    .select('u.*')
    .first();

  log.info('Admin user search result', { found: !!user, tenantId });
  return user;
}

// Reuse existing activity
export async function generateTemporaryPassword(): Promise<string> {
  const log = logger();
  log.info('Generating temporary password');
  return generatePassword();
}

export async function updateUserPassword(
  userId: string,
  tenantId: string,
  password: string
): Promise<void> {
  const log = logger();
  log.info('Updating user password', { userId, tenantId });

  const knex = await getAdminConnection();
  const hashedPassword = await hashPassword(password);

  await knex('users')
    .where({ user_id: userId, tenant: tenantId })
    .update({
      hashed_password: hashedPassword,
      updated_at: knex.fn.now(),
    });

  log.info('Password updated successfully', { userId });
}

// Wrapper for existing sendWelcomeEmail activity
export async function sendWelcomeEmail(input: {
  tenantId: string;
  tenantName: string;
  adminUser: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  temporaryPassword: string;
}) {
  const log = logger();
  log.info('Sending welcome email', {
    tenantId: input.tenantId,
    email: input.adminUser.email
  });

  const emailInput: SendWelcomeEmailActivityInput = {
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    adminUser: {
      userId: input.adminUser.userId,
      email: input.adminUser.email,
      firstName: input.adminUser.firstName,
      lastName: input.adminUser.lastName,
    },
    temporaryPassword: input.temporaryPassword,
  };

  const result = await sendEmail(emailInput);
  log.info('Welcome email sent', { success: result.emailSent, email: input.adminUser.email });
  return result;
}

export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  const log = logger();
  log.info('Logging audit event', {
    action: input.action,
    tenantId: input.tenantId,
    resourceType: input.resourceType
  });

  const knex = await getAdminConnection();
  const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID!;

  // Log to extension_audit_logs table (unified table for all extension actions)
  await knex('extension_audit_logs').insert({
    tenant: MASTER_BILLING_TENANT_ID,  // Extension actions logged under master tenant
    event_type: `tenant.${input.action.toLowerCase().replace(/_/g, '.')}`,
    user_id: input.triggeredBy,
    user_email: input.triggeredByEmail,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    details: JSON.stringify({
      ...input.details,
      targetTenantId: input.tenantId,
    }),
  });

  log.info('Audit event logged successfully', { action: input.action });
}
