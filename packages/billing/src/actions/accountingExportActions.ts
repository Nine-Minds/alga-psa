'use server';

import { AccountingExportService } from '../services/accountingExportService';
import type {
  AccountingExportBatch,
  AccountingExportError,
  AccountingExportLine,
  AccountingExportStatus,
  IUser,
  IUserWithRoles
} from '@alga-psa/types';
import type {
  CreateExportBatchInput,
  CreateExportLineInput,
  CreateExportErrorInput,
  UpdateExportBatchStatusInput
} from '../repositories/accountingExportRepository';
import type { AccountingExportDeliveryResult } from '../lib/adapters/accounting/accountingExportAdapter';
import { AccountingExportInvoiceSelector, type InvoiceSelectionFilters } from '../services/accountingExportInvoiceSelector';


import { AppError } from '@alga-psa/core';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

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
  adapterType?: string;
  targetRealm?: string;
  excludeSyncedInvoices?: boolean;
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

function checkAccountingExportPermission(
  user: IUserWithRoles,
  action: AccountingExportPermission
): void {
  if (user.user_type === 'client') {
    throw new AppError(
      'ACCOUNTING_EXPORT_FORBIDDEN',
      'Client portal users are not permitted to manage accounting exports'
    );
  }

  // Accounting exports are currently managed from billing/integrations surfaces; gate with billing settings permissions.
  // Map export actions to billing_settings read/update to align with mapping + CSV export permissions.
  const billingAction = action === 'read' ? 'read' : 'update';
  const allowed = hasPermission(user, 'billing_settings', billingAction);
  if (!allowed) {
    throw new AppError(
      'ACCOUNTING_EXPORT_FORBIDDEN',
      `Permission denied: Cannot ${ACTION_DESCRIPTIONS[action]}`
    );
  }
}

export const createAccountingExportBatch = withAuth(async (
  user,
  { tenant },
  input: CreateExportBatchInput
): Promise<AccountingExportBatch> => {
  await checkAccountingExportPermission(user, 'create');
  const selector = await AccountingExportInvoiceSelector.create();
  const filters = normalizeCreateBatchFilters(input.filters);
  const { batch } = await selector.createBatchFromFilters({
    adapterType: input.adapter_type,
    targetRealm: input.target_realm ?? null,
    notes: input.notes ?? null,
    createdBy: input.created_by ?? user.user_id,
    filters
  });
  return batch;
});

export const appendAccountingExportLines = withAuth(async (
  user,
  { tenant },
  batchId: string,
  lines: CreateExportLineInput[]
): Promise<AccountingExportLine[]> => {
  await checkAccountingExportPermission(user, 'update');
  const service = await AccountingExportService.create();
  return service.appendLines(batchId, { lines });
});

export const appendAccountingExportErrors = withAuth(async (
  user,
  { tenant },
  batchId: string,
  errors: CreateExportErrorInput[]
): Promise<AccountingExportError[]> => {
  await checkAccountingExportPermission(user, 'update');
  const service = await AccountingExportService.create();
  return service.appendErrors(batchId, { errors });
});

export const updateAccountingExportBatchStatus = withAuth(async (
  user,
  { tenant },
  batchId: string,
  updates: UpdateExportBatchStatusInput
): Promise<AccountingExportBatch | null> => {
  await checkAccountingExportPermission(user, 'update');
  const service = await AccountingExportService.create();
  return service.updateBatchStatus(batchId, {
    ...updates,
    last_updated_by: updates.last_updated_by ?? user.user_id
  });
});

export const getAccountingExportBatch = withAuth(async (
  user,
  { tenant },
  batchId: string
): Promise<{
  batch: AccountingExportBatch | null;
  lines: AccountingExportLine[];
  errors: AccountingExportError[];
}> => {
  await checkAccountingExportPermission(user, 'read');
  const service = await AccountingExportService.create();
  return service.getBatchWithDetails(batchId);
});

export const listAccountingExportBatches = withAuth(async (
  user,
  { tenant },
  params: { status?: AccountingExportStatus; adapter_type?: string } = {}
): Promise<AccountingExportBatch[]> => {
  await checkAccountingExportPermission(user, 'read');
  const service = await AccountingExportService.create();
  return service.listBatches(params);
});

export const executeAccountingExportBatch = withAuth(async (
  user,
  { tenant },
  batchId: string
): Promise<AccountingExportDeliveryResult> => {
  await checkAccountingExportPermission(user, 'execute');
  const service = await AccountingExportService.create();
  return service.executeBatch(batchId);
});

export const previewAccountingExport = withAuth(async (
  user,
  { tenant },
  filters: AccountingExportPreviewFilters = {}
): Promise<AccountingExportPreviewResult> => {
  await checkAccountingExportPermission(user, 'read');

  const selector = await AccountingExportInvoiceSelector.create();
  const normalizedFilters: InvoiceSelectionFilters = {
    startDate: toOptionalString(filters.startDate),
    endDate: toOptionalString(filters.endDate),
    invoiceStatuses: toStringArray(filters.invoiceStatuses),
    clientIds: toStringArray(filters.clientIds),
    clientSearch: toOptionalString(filters.clientSearch),
    adapterType: toOptionalString(filters.adapterType),
    targetRealm: toOptionalString(filters.targetRealm) ?? null,
    excludeSyncedInvoices: true
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

function normalizeCreateBatchFilters(
  filters: Record<string, unknown> | null | undefined
): InvoiceSelectionFilters {
  const result: InvoiceSelectionFilters = {};
  if (!filters) {
    return result;
  }

  const startDate = toFilterString(filters.start_date ?? filters.startDate);
  if (startDate) {
    result.startDate = startDate;
  }

  const endDate = toFilterString(filters.end_date ?? filters.endDate);
  if (endDate) {
    result.endDate = endDate;
  }

  const invoiceStatuses =
    toFilterStringArray(
      filters.invoice_statuses ??
        filters.invoiceStatuses ??
        filters.statuses ??
        filters.status
    );
  if (invoiceStatuses && invoiceStatuses.length > 0) {
    result.invoiceStatuses = invoiceStatuses;
  }

  const clientIds = toFilterStringArray(filters.client_ids ?? filters.clientIds);
  if (clientIds && clientIds.length > 0) {
    result.clientIds = clientIds;
  }

  const clientSearch = toFilterString(filters.client_search ?? filters.clientSearch);
  if (clientSearch) {
    result.clientSearch = clientSearch;
  }

  const excludeSyncedRaw =
    typeof filters.exclude_synced_invoices === 'boolean'
      ? (filters.exclude_synced_invoices as boolean)
      : typeof filters.excludeSyncedInvoices === 'boolean'
        ? (filters.excludeSyncedInvoices as boolean)
        : undefined;
  if (excludeSyncedRaw !== undefined) {
    result.excludeSyncedInvoices = excludeSyncedRaw;
  }

  return result;
}

function toFilterString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toFilterStringArray(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
      .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }

  if (typeof value === 'string') {
    const segments = value
      .split(',')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    return segments.length > 0 ? Array.from(new Set(segments)) : undefined;
  }

  return undefined;
}
