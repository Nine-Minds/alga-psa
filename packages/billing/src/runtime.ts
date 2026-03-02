import type {
  AccountingExportBatch,
  AccountingExportDeliveryResult,
} from '@alga-psa/types';
import type { CreateExportBatchInput } from './repositories/accountingExportRepository';
import type { InvoiceSelectionFilters } from './services/accountingExportInvoiceSelector';
import { AccountingExportInvoiceSelector } from './services/accountingExportInvoiceSelector';
import { AccountingExportService } from './services/accountingExportService';

/**
 * Runtime-safe billing exports for worker/shared execution contexts.
 * These helpers intentionally avoid UI/auth wrappers used by server actions.
 */
export async function createAccountingExportBatch(
  input: CreateExportBatchInput,
  tenantId: string
): Promise<AccountingExportBatch> {
  const selector = await AccountingExportInvoiceSelector.createForTenant(tenantId);
  const filters = normalizeCreateBatchFilters(input.filters);
  const { batch } = await selector.createBatchFromFilters({
    adapterType: input.adapter_type,
    targetRealm: input.target_realm ?? null,
    notes: input.notes ?? null,
    createdBy: input.created_by ?? null,
    filters,
  });
  return batch;
}

export async function executeAccountingExportBatch(
  batchId: string,
  tenantId: string
): Promise<AccountingExportDeliveryResult> {
  const service = await AccountingExportService.createForTenant(tenantId);
  return service.executeBatch(batchId);
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

  const invoiceStatuses = toFilterStringArray(
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

  const adapterType = toFilterString(filters.adapter_type ?? filters.adapterType);
  if (adapterType) {
    result.adapterType = adapterType;
  }

  const targetRealm = toFilterString(filters.target_realm ?? filters.targetRealm);
  if (targetRealm) {
    result.targetRealm = targetRealm;
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
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function toFilterStringArray(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => String(entry).trim())
      .filter(Boolean);
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
