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
import { AccountingExportInvoiceSelector, InvoiceSelectionFilters } from '../services/accountingExportInvoiceSelector';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from '../auth/rbac';
import { AppError } from '../errors';
import { IUser } from '../../interfaces/auth.interfaces';
import { getCurrentTenantId, getTenantContext, runWithTenant } from '../db';
import { getConnection } from '../db/db';

type AccountingExportPermission = 'create' | 'read' | 'update' | 'execute';

const ACTION_DESCRIPTIONS: Record<AccountingExportPermission, string> = {
  create: 'create accounting export batches',
  read: 'access accounting export batches',
  update: 'modify accounting export batches',
  execute: 'execute accounting export batches'
};

const PREVIEW_LINE_LIMIT = 50;

export interface AccountingExportPreviewFilters {
  startDate?: string;
  endDate?: string;
  invoiceStatuses?: string[] | string;
  clientIds?: string[] | string;
  clientSearch?: string;
}

export interface AccountingExportPreviewLine {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceStatus: string;
  clientName: string | null;
  chargeId: string;
  amountCents: number;
  currencyCode: string;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
}

export interface AccountingExportPreviewResult {
  invoiceCount: number;
  lineCount: number;
  totalsByCurrency: Record<string, number>;
  lines: AccountingExportPreviewLine[];
  truncated: boolean;
}

interface PermissionOverrideContext {
  user?: IUser;
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

  let tenant = await getTenantContext();
  if (!tenant) {
    tenant = (await getCurrentTenantId()) ?? undefined;
  }
  if (!tenant) {
    throw new AppError('ACCOUNTING_EXPORT_TENANT_REQUIRED', 'Tenant context is required for accounting export operations');
  }

  const knex = await getConnection(tenant);
  const allowed = await hasPermission(currentUser, 'accountingExports', action, knex);
  if (!allowed) {
    throw new AppError(
      'ACCOUNTING_EXPORT_FORBIDDEN',
      `Permission denied: Cannot ${ACTION_DESCRIPTIONS[action]}`
    );
  }

  return { currentUser, tenant };
}

export async function createAccountingExportBatch(
  input: CreateExportBatchInput,
  override?: PermissionOverrideContext
): Promise<AccountingExportBatch> {
  const { currentUser, tenant } = await requireAccountingExportPermission('create', override);
  return runWithTenant(tenant, async () => {
    const service = await AccountingExportService.create();
    return service.createBatch({
      ...input,
      created_by: input.created_by ?? currentUser.user_id
    });
  });
}

export async function appendAccountingExportLines(
  batchId: string,
  lines: CreateExportLineInput[],
  override?: PermissionOverrideContext
): Promise<AccountingExportLine[]> {
  const { tenant } = await requireAccountingExportPermission('update', override);
  return runWithTenant(tenant, async () => {
    const service = await AccountingExportService.create();
    return service.appendLines(batchId, { lines });
  });
}

export async function appendAccountingExportErrors(
  batchId: string,
  errors: CreateExportErrorInput[],
  override?: PermissionOverrideContext
): Promise<AccountingExportError[]> {
  const { tenant } = await requireAccountingExportPermission('update', override);
  return runWithTenant(tenant, async () => {
    const service = await AccountingExportService.create();
    return service.appendErrors(batchId, { errors });
  });
}

export async function updateAccountingExportBatchStatus(
  batchId: string,
  updates: UpdateExportBatchStatusInput,
  override?: PermissionOverrideContext
): Promise<AccountingExportBatch | null> {
  const { currentUser, tenant } = await requireAccountingExportPermission('update', override);
  return runWithTenant(tenant, async () => {
    const service = await AccountingExportService.create();
    return service.updateBatchStatus(batchId, {
      ...updates,
      last_updated_by: updates.last_updated_by ?? currentUser.user_id
    });
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
  const { tenant } = await requireAccountingExportPermission('read', override);
  return runWithTenant(tenant, async () => {
    const service = await AccountingExportService.create();
    return service.getBatchWithDetails(batchId);
  });
}

export async function listAccountingExportBatches(
  params: { status?: AccountingExportStatus; adapter_type?: string } = {},
  override?: PermissionOverrideContext
): Promise<AccountingExportBatch[]> {
  const { tenant } = await requireAccountingExportPermission('read', override);
  return runWithTenant(tenant, async () => {
    const service = await AccountingExportService.create();
    return service.listBatches(params);
  });
}

export async function executeAccountingExportBatch(
  batchId: string,
  override?: PermissionOverrideContext
): Promise<AccountingExportDeliveryResult> {
  const { tenant } = await requireAccountingExportPermission('execute', override);
  return runWithTenant(tenant, async () => {
    const service = await AccountingExportService.create();
    return service.executeBatch(batchId);
  });
}

export async function previewAccountingExport(
  filters: AccountingExportPreviewFilters = {},
  override?: PermissionOverrideContext
): Promise<AccountingExportPreviewResult> {
  const { tenant } = await requireAccountingExportPermission('read', override);

  return runWithTenant(tenant, async () => {
    const selector = await AccountingExportInvoiceSelector.create();
    const normalizedFilters: InvoiceSelectionFilters = {
      startDate: toOptionalString(filters.startDate),
      endDate: toOptionalString(filters.endDate),
      invoiceStatuses: toStringArray(filters.invoiceStatuses),
      clientIds: toStringArray(filters.clientIds),
      clientSearch: toOptionalString(filters.clientSearch)
    };

    const lines = await selector.previewInvoiceLines(normalizedFilters);
    const totalsByCurrency = lines.reduce<Record<string, number>>((acc, line) => {
      const currency = line.currencyCode || 'USD';
      acc[currency] = (acc[currency] ?? 0) + line.amountCents;
      return acc;
    }, {});
    const invoiceCount = new Set(lines.map((line) => line.invoiceId)).size;

    const limitedLines = lines.slice(0, PREVIEW_LINE_LIMIT).map<AccountingExportPreviewLine>((line) => ({
      invoiceId: line.invoiceId,
      invoiceNumber: line.invoiceNumber,
      invoiceDate: line.invoiceDate,
      invoiceStatus: line.invoiceStatus,
      clientName: line.clientName,
      chargeId: line.chargeId,
      amountCents: line.amountCents,
      currencyCode: line.currencyCode || 'USD',
      servicePeriodStart: line.servicePeriodStart ?? null,
      servicePeriodEnd: line.servicePeriodEnd ?? null
    }));

    return {
      invoiceCount,
      lineCount: lines.length,
      totalsByCurrency,
      lines: limitedLines,
      truncated: lines.length > limitedLines.length
    };
  });
}

function toOptionalString(value: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined;
    }
    const first = String(value[0]).trim();
    return first.length > 0 ? first : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function toStringArray(value: string[] | string | undefined | null): string[] | undefined {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry).trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === 'string') {
    const segments = value
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean);
    return segments.length > 0 ? segments : undefined;
  }

  return undefined;
}
