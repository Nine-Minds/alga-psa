'use server';

import { AccountingExportService } from '../services/accountingExportService';
import type {
  AccountingExportBatch,
  AccountingExportError,
  AccountingExportLine,
  AccountingExportStatus,
  IUser
} from '@alga-psa/types';
import type {
  CreateExportBatchInput,
  CreateExportLineInput,
  CreateExportErrorInput,
  UpdateExportBatchStatusInput
} from '../repositories/accountingExportRepository';
import type { AccountingExportDeliveryResult } from '../lib/adapters/accounting/accountingExportAdapter';
import { AccountingExportInvoiceSelector, type InvoiceSelectionFilters } from '../services/accountingExportInvoiceSelector';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '@alga-psa/auth';
import { AppError } from '@alga-psa/core';
import { getTenantContext, runWithTenant } from '@alga-psa/db';
import { getConnection } from '@alga-psa/db';

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

  let tenant = getTenantContext() ?? (typeof (currentUser as any)?.tenant === 'string' ? (currentUser as any).tenant : undefined);
  if (!tenant) {
    throw new AppError('ACCOUNTING_EXPORT_TENANT_REQUIRED', 'Tenant context is required for accounting export operations');
  }

  const knex = await getConnection(tenant);
  // Accounting exports are currently managed from billing/integrations surfaces; gate with billing settings permissions.
  // Map export actions to billing_settings read/update to align with mapping + CSV export permissions.
  const billingAction = action === 'read' ? 'read' : 'update';
  const allowed = await hasPermission(currentUser, 'billing_settings', billingAction, knex);
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
    const selector = await AccountingExportInvoiceSelector.create();
    const filters = normalizeCreateBatchFilters(input.filters);
    const { batch } = await selector.createBatchFromFilters({
      adapterType: input.adapter_type,
      targetRealm: input.target_realm ?? null,
      notes: input.notes ?? null,
      createdBy: input.created_by ?? currentUser.user_id,
      filters
    });
    return batch;
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
