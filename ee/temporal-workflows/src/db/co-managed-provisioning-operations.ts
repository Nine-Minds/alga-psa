import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { runCoManagedProvisioningStep, finalizeCoManagedProvisioning, type CoManagedProvisioningOperation } from '@alga-psa/co-managed';
import { seedBoardTicketStatusesFromStandards } from '@alga-psa/shared/lib/boardTicketDefaults.js';
import { createTenantInDB, setupTenantDataInDB } from './tenant-operations.js';
import { runOnboardingSeeds } from './onboarding-seeds-operations.js';
import type { TenantBootstrapLog } from './tenant-bootstrap-context.js';

/** Bootstrap using the same tenant, seed, settings and board engines as normal
 * onboarding. The sponsor owns only request/progress; all operational data and
 * the invitation token belong to the new customer. No customer password exists. */
export async function bootstrapCoManagedWorkspace(db: Knex, sponsorTenant: string, operationId: string,
  log: TenantBootstrapLog): Promise<void> {
  const existing = await tenantDb(db, sponsorTenant).table('co_managed_provisioning_operations').where('operation_id', operationId).first();
  if (existing?.state === 'pending_acceptance') return;
  await runCoManagedProvisioningStep(db, sponsorTenant, operationId, 'tenant', async (trx, operation) => {
    const { request } = operation;
    await createTenantInDB({ tenantId: operation.customer_tenant, tenantName: request.workspaceName,
      companyName: request.workspaceName, clientName: request.workspaceName, email: request.administrator.email,
      licenseCount: request.seats, plan: 'pro', productCode: 'co_managed', billingSource: 'manual',
    }, { transaction: trx, log, coManagedOperation: { sponsorTenant, operationId } });
  });
  await runCoManagedProvisioningStep(db, sponsorTenant, operationId, 'seeds', async (trx, operation) => {
    await runOnboardingSeeds(operation.customer_tenant, 'co_managed', { transaction: trx, log });
  });
  await runCoManagedProvisioningStep(db, sponsorTenant, operationId, 'settings', async (trx, operation) => {
    const tenant = operation.customer_tenant;
    const customer = tenantDb(trx, tenant);
    await setupTenantDataInDB({ tenantId: tenant, clientId: operation.customer_client_id }, { transaction: trx, log });
    await customer.table('boards').insert({ tenant, board_id: operation.customer_board_id,
      board_name: 'Service Desk', is_default: true, is_inactive: false });
    const statuses = await seedBoardTicketStatusesFromStandards(trx, tenant, operation.customer_board_id, null);
    if (!statuses) throw new Error('Standard ticket statuses must be installed before provisioning a customer workspace');
    const priorities = await customer.table('standard_priorities').where({ item_type: 'ticket', is_itil_standard: false }).orderBy('order_number');
    if (!priorities.length) throw new Error('Standard ticket priorities must be installed before provisioning a customer workspace');
    await customer.table('priorities').insert(priorities.map(priority => ({ tenant,
      priority_name: priority.priority_name, order_number: priority.order_number, color: priority.color,
      item_type: 'ticket', created_by: null,
    })));
    await customer.table('next_number').insert({ tenant, entity_type: 'TICKET', prefix: '', padding_length: 6,
      last_number: 0, initial_value: 1 }).onConflict(['tenant', 'entity_type']).ignore();
    await customer.table('contacts').insert({ tenant, client_id: operation.customer_client_id,
      full_name: `${operation.request.administrator.firstName} ${operation.request.administrator.lastName}`,
      email: operation.request.administrator.email, role: 'IT Administrator', is_inactive: false,
    });
  });
  await runCoManagedProvisioningStep(db, sponsorTenant, operationId, 'administrator_invitation', async (trx, operation) => {
    await createInitialAdministratorInvitation(trx, operation);
  });
  await finalizeCoManagedProvisioning(db, sponsorTenant, operationId);
}

async function createInitialAdministratorInvitation(trx: Knex.Transaction, operation: CoManagedProvisioningOperation): Promise<void> {
  const customer = tenantDb(trx, operation.customer_tenant);
  const role = await customer.table('roles').where({ role_name: 'Admin', msp: true, client: false }).first();
  if (!role) throw new Error('Customer administrator role is missing');
  const administrator = operation.request.administrator;
  await customer.table('user_invitations').insert({ tenant: operation.customer_tenant,
    invitation_id: operation.administrator_invitation_id, email: administrator.email,
    first_name: administrator.firstName, last_name: administrator.lastName, role_id: role.role_id,
    token: randomBytes(32).toString('hex'), expires_at: trx.raw("now() + interval '24 hours'"),
    metadata: { co_managed_initial_admin: true, co_managed_relationship_id: operation.relationship_id,
      sponsor_tenant: operation.tenant, invited_by_user_id: operation.requested_by },
  });
}
