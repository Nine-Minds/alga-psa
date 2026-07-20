'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles, ProjectPaymentWarning, ProjectPaymentWarningKind } from '@alga-psa/types';
import type { Knex } from 'knex';
import { withProjectBillingActionErrors } from './projectBillingActionErrors';

// DTOs live in @alga-psa/types; re-exported here for existing consumers.
export type { ProjectPaymentWarning, ProjectPaymentWarningKind };

interface PaymentWarningRow {
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  schedule_description: string;
}

function warningKind(status: string): ProjectPaymentWarningKind {
  if (status === 'draft' || status === 'pending') return 'invoice_preparation';
  if (status === 'cancelled' || status === 'void') return 'replacement_needed';
  return 'payment_outstanding';
}

async function findPaymentWarning(
  knex: Knex,
  tenant: string,
  projectId: string,
): Promise<PaymentWarningRow | null> {
  const row = await knex('project_billing_schedule_entries as entry')
    .join('project_billing_configs as config', function joinConfig() {
      this.on('config.tenant', '=', 'entry.tenant')
        .andOn('config.config_id', '=', 'entry.config_id');
    })
    .join('invoices as invoice', function joinInvoice() {
      this.on('invoice.tenant', '=', 'entry.tenant')
        .andOn('invoice.invoice_id', '=', 'entry.invoice_id');
    })
    .where('entry.tenant', tenant)
    .andWhere('config.project_id', projectId)
    .andWhere('entry.requires_payment_before_work', true)
    .whereNot('invoice.status', 'paid')
    .orderBy('entry.display_order', 'asc')
    .orderBy('entry.created_at', 'asc')
    .first<PaymentWarningRow>(
      'invoice.invoice_id',
      'invoice.invoice_number',
      'invoice.status as invoice_status',
      'entry.description as schedule_description',
    );
  return row ?? null;
}

async function resolveTaskProjectId(
  knex: Knex,
  tenant: string,
  taskId: string,
): Promise<string> {
  const row = await knex('project_tasks as task')
    .join('project_phases as phase', function joinPhase() {
      this.on('phase.tenant', '=', 'task.tenant')
        .andOn('phase.phase_id', '=', 'task.phase_id');
    })
    .where('task.tenant', tenant)
    .andWhere('task.task_id', taskId)
    .first<{ project_id: string }>('phase.project_id');
  if (!row) throw new Error('Project task not found');
  return row.project_id;
}

async function getWarningForProject(
  user: IUserWithRoles,
  tenant: string,
  projectId: string,
): Promise<ProjectPaymentWarning | null> {
  if (user.user_type === 'client') {
    throw new Error('Permission denied: project payment work warnings are for internal users');
  }
  if (!await hasPermission(user, 'project', 'read')) {
    throw new Error('Permission denied: Cannot view project');
  }

  const { knex } = await createTenantKnex();
  const project = await knex('projects')
    .where({ tenant, project_id: projectId })
    .first('project_id');
  if (!project) throw new Error('Project not found');

  const row = await findPaymentWarning(knex, tenant, projectId);
  if (!row) return null;

  const canReadBilling = await hasPermission(user, 'billing', 'read', knex);
  if (!canReadBilling) {
    return {
      kind: warningKind(row.invoice_status),
      has_billing_details: false,
    };
  }
  return {
    kind: warningKind(row.invoice_status),
    has_billing_details: true,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    invoice_status: row.invoice_status,
    schedule_description: row.schedule_description,
  };
}

export const getProjectPaymentWarning = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  projectId: string,
): Promise<ProjectPaymentWarning | null> => getWarningForProject(user, tenant, projectId)));

export const getProjectTaskPaymentWarning = withAuth(withProjectBillingActionErrors(async (
  user,
  { tenant },
  taskId: string,
): Promise<ProjectPaymentWarning | null> => {
  const { knex } = await createTenantKnex();
  const projectId = await resolveTaskProjectId(knex, tenant, taskId);
  return getWarningForProject(user, tenant, projectId);
}));
