'use server';

import { AccountingExportService } from '../services/accountingExportService';
import {
  AccountingExportBatch,
  AccountingExportError,
  AccountingExportLine,
  AccountingExportStatus
} from '../../interfaces/accountingExport.interfaces';
import {
  CreateExportBatchInput,
  CreateExportLineInput,
  CreateExportErrorInput,
  UpdateExportBatchStatusInput
} from '../repositories/accountingExportRepository';
import { AccountingExportDeliveryResult } from '../adapters/accounting/accountingExportAdapter';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from '../auth/rbac';
import { createTenantKnex } from '../db';
import { AppError } from '../errors';
import { IUser } from '../../interfaces/auth.interfaces';

type AccountingExportPermission = 'create' | 'read' | 'update' | 'execute';

const ACTION_DESCRIPTIONS: Record<AccountingExportPermission, string> = {
  create: 'create accounting export batches',
  read: 'access accounting export batches',
  update: 'modify accounting export batches',
  execute: 'execute accounting export batches'
};

interface PermissionOverrideContext {
  user?: IUser;
  tenant?: string;
}

async function requireAccountingExportPermission(action: AccountingExportPermission, override?: PermissionOverrideContext) {
  const currentUser = override?.user ?? (await getCurrentUser());
  if (!currentUser) {
    throw new AppError('ACCOUNTING_EXPORT_UNAUTHENTICATED', 'Authentication required to manage accounting exports');
  }

  if (currentUser.user_type === 'client') {
    throw new AppError(
      'ACCOUNTING_EXPORT_FORBIDDEN',
      'Client portal users are not permitted to manage accounting exports'
    );
  }

  const { knex, tenant } = await createTenantKnex();
  const effectiveTenant = override?.tenant ?? tenant;

  if (!effectiveTenant) {
    throw new AppError('ACCOUNTING_EXPORT_TENANT_REQUIRED', 'Tenant context is required for accounting export operations');
  }

  const allowed = await hasPermission(currentUser, 'accountingExports', action, knex);
  if (!allowed) {
    throw new AppError(
      'ACCOUNTING_EXPORT_FORBIDDEN',
      `Permission denied: Cannot ${ACTION_DESCRIPTIONS[action]}`
    );
  }

  return { currentUser, tenant: effectiveTenant };
}

export async function createAccountingExportBatch(
  input: CreateExportBatchInput,
  override?: PermissionOverrideContext
): Promise<AccountingExportBatch> {
  const { currentUser } = await requireAccountingExportPermission('create', override);
  const service = await AccountingExportService.create();
  return service.createBatch({
    ...input,
    created_by: input.created_by ?? currentUser.user_id
  });
}

export async function appendAccountingExportLines(
  batchId: string,
  lines: CreateExportLineInput[],
  override?: PermissionOverrideContext
): Promise<AccountingExportLine[]> {
  await requireAccountingExportPermission('update', override);
  const service = await AccountingExportService.create();
  return service.appendLines(batchId, { lines });
}

export async function appendAccountingExportErrors(
  batchId: string,
  errors: CreateExportErrorInput[],
  override?: PermissionOverrideContext
): Promise<AccountingExportError[]> {
  await requireAccountingExportPermission('update', override);
  const service = await AccountingExportService.create();
  return service.appendErrors(batchId, { errors });
}

export async function updateAccountingExportBatchStatus(
  batchId: string,
  updates: UpdateExportBatchStatusInput,
  override?: PermissionOverrideContext
): Promise<AccountingExportBatch | null> {
  const { currentUser } = await requireAccountingExportPermission('update', override);
  const service = await AccountingExportService.create();
  return service.updateBatchStatus(batchId, {
    ...updates,
    last_updated_by: updates.last_updated_by ?? currentUser.user_id
  });
}

export async function getAccountingExportBatch(
  batchId: string,
  override?: PermissionOverrideContext
): Promise<{
  batch: AccountingExportBatch | null;
  lines: AccountingExportLine[];
  errors: AccountingExportError[];
}> {
  await requireAccountingExportPermission('read', override);
  const service = await AccountingExportService.create();
  return service.getBatchWithDetails(batchId);
}

export async function listAccountingExportBatches(
  params: { status?: AccountingExportStatus; adapter_type?: string } = {},
  override?: PermissionOverrideContext
): Promise<AccountingExportBatch[]> {
  await requireAccountingExportPermission('read', override);
  const service = await AccountingExportService.create();
  return service.listBatches(params);
}

export async function executeAccountingExportBatch(
  batchId: string,
  override?: PermissionOverrideContext
): Promise<AccountingExportDeliveryResult> {
  await requireAccountingExportPermission('execute', override);
  const service = await AccountingExportService.create();
  return service.executeBatch(batchId);
}
