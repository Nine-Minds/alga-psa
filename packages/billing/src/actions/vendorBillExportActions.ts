'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { enqueueVendorBillExportRetry } from '../services/accountingSync/syncProducers';
import { resolveConnectedAccountingIntegration } from '../services/accountingSync/connectedAccountingIntegration';
import { ADAPTER_EXPORT_CAPABILITIES } from '../adapters/accounting/registry';
import type { Knex } from 'knex';
import type { VendorBillExportStatus } from '@alga-psa/inventory/lib/integrationTypes';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type { VendorBillExportStatus, VendorBillExportState } from '@alga-psa/inventory/lib/integrationTypes';

type VendorBillExportActionError = ActionMessageError | ActionPermissionError;
export interface VendorBillExportContext {
  integration: {
    adapterType: 'quickbooks_online' | 'xero';
    label: string;
  } | null;
  vendorBillsSupported: boolean;
}

type ExportStatusRow = {
  bill_id: string;
  line_status: string | null;
  batch_status: string | null;
  external_document_ref: string | null;
  line_notes: string | null;
  batch_notes: string | null;
  delivered_at: string | Date | null;
  line_created_at: string | Date | null;
  line_updated_at: string | Date | null;
  batch_updated_at: string | Date | null;
};

type MappingStatusRow = {
  bill_id: string;
  external_ref: string | null;
  last_synced_at: string | Date | null;
};

type OperationStatusRow = {
  bill_id: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  last_error: string | null;
  created_at: string | Date | null;
  processed_at: string | Date | null;
};

function adapterSupportsExportType(adapterType: string, exportType: string): boolean {
  const capabilities = ADAPTER_EXPORT_CAPABILITIES as Record<string, readonly string[] | undefined>;
  return Boolean(capabilities[adapterType]?.includes(exportType));
}

function labelForAdapter(adapterType: 'quickbooks_online' | 'xero'): string {
  return adapterType === 'quickbooks_online' ? 'QuickBooks Online' : 'Xero';
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function exportedStatusFromExportRow(row: ExportStatusRow): VendorBillExportStatus | null {
  const lineStatus = row.line_status ?? '';
  const batchStatus = row.batch_status ?? '';
  const externalRef = row.external_document_ref ?? null;

  if (lineStatus === 'delivered' || lineStatus === 'posted' || batchStatus === 'delivered' || batchStatus === 'posted') {
    return {
      bill_id: row.bill_id,
      state: 'exported',
      exported_at: toIso(row.delivered_at ?? row.line_updated_at ?? row.batch_updated_at),
      external_ref: externalRef,
      error_message: null,
    };
  }

  return null;
}

function pendingStatusFromExportRow(row: ExportStatusRow): VendorBillExportStatus | null {
  const lineStatus = row.line_status ?? '';
  const batchStatus = row.batch_status ?? '';
  const externalRef = row.external_document_ref ?? null;

  if (
    lineStatus === 'pending' ||
    lineStatus === 'ready' ||
    batchStatus === 'pending' ||
    batchStatus === 'validating' ||
    batchStatus === 'ready'
  ) {
    return {
      bill_id: row.bill_id,
      state: 'pending',
      exported_at: null,
      external_ref: externalRef,
      error_message: null,
    };
  }

  return null;
}

function errorStatusFromExportRow(row: ExportStatusRow): VendorBillExportStatus | null {
  const lineStatus = row.line_status ?? '';
  const batchStatus = row.batch_status ?? '';
  const externalRef = row.external_document_ref ?? null;

  if (lineStatus === 'failed' || batchStatus === 'failed' || batchStatus === 'needs_attention') {
    return {
      bill_id: row.bill_id,
      state: 'error',
      exported_at: null,
      external_ref: externalRef,
      error_message: row.line_notes ?? row.batch_notes ?? 'Vendor bill export failed',
    };
  }

  return null;
}

function pendingStatusFromOperationRow(row: OperationStatusRow): VendorBillExportStatus | null {
  if (row.status !== 'pending' && row.status !== 'in_progress') {
    return null;
  }

  return {
    bill_id: row.bill_id,
    state: 'pending',
    exported_at: null,
    external_ref: null,
    error_message: null,
  };
}

function errorStatusFromOperationRow(row: OperationStatusRow): VendorBillExportStatus | null {
  if (row.status !== 'failed' && row.status !== 'skipped') {
    return null;
  }

  return {
    bill_id: row.bill_id,
    state: 'error',
    exported_at: null,
    external_ref: null,
    error_message: row.last_error ?? 'Vendor bill export failed',
  };
}

export async function getVendorBillExportStatusesForTenant(
  trx: Knex.Transaction | Knex,
  tenant: string,
  billIds: string[],
): Promise<VendorBillExportStatus[]> {
  const uniqueBillIds = Array.from(new Set(billIds.filter(Boolean)));
  if (uniqueBillIds.length === 0) {
    return [];
  }

  const exportRows = (await trx('accounting_export_lines as line')
    .join('accounting_export_batches as batch', function joinBatch() {
      this.on('batch.batch_id', '=', 'line.batch_id').andOn('batch.tenant', '=', 'line.tenant');
    })
    .where({
      'line.tenant': tenant,
      'batch.tenant': tenant,
      'batch.export_type': 'vendor_bill',
    })
    .whereIn('line.document_id', uniqueBillIds)
    .orderBy('line.created_at', 'desc')
    .select(
      'line.document_id as bill_id',
      'line.status as line_status',
      'batch.status as batch_status',
      'line.external_document_ref',
      'line.notes as line_notes',
      'batch.notes as batch_notes',
      'batch.delivered_at',
      'line.created_at as line_created_at',
      'line.updated_at as line_updated_at',
      'batch.updated_at as batch_updated_at',
    )) as ExportStatusRow[];

  const latestByBillId = new Map<string, VendorBillExportStatus>();

  for (const row of exportRows) {
    const status = exportedStatusFromExportRow(row);
    if (status && !latestByBillId.has(row.bill_id)) {
      latestByBillId.set(row.bill_id, status);
    }
  }

  const integration = await resolveConnectedAccountingIntegration(trx as Knex, tenant);
  const mappingIntegrationType = integration?.adapterType ?? null;
  const missingAfterDelivered = uniqueBillIds.filter((billId) => !latestByBillId.has(billId));
  if (mappingIntegrationType && missingAfterDelivered.length > 0) {
    const mappingRows = (await trx('tenant_external_entity_mappings')
      .where({
        tenant,
        integration_type: mappingIntegrationType,
        alga_entity_type: 'vendor_bill',
      })
      .whereIn('alga_entity_id', missingAfterDelivered)
      .select(
        'alga_entity_id as bill_id',
        'external_entity_id as external_ref',
        'last_synced_at',
      )) as MappingStatusRow[];

    for (const row of mappingRows) {
      latestByBillId.set(row.bill_id, {
        bill_id: row.bill_id,
        state: 'exported',
        exported_at: toIso(row.last_synced_at),
        external_ref: row.external_ref,
        error_message: null,
      });
    }
  }

  const operationRows = (await trx('accounting_sync_operations')
    .where({
      tenant,
      operation: 'export_vendor_bill',
      alga_entity_type: 'vendor_bill',
    })
    .whereIn('alga_entity_id', uniqueBillIds)
    .whereIn('status', ['pending', 'in_progress', 'failed', 'skipped'])
    .orderBy('created_at', 'desc')
    .select(
      'alga_entity_id as bill_id',
      'status',
      'last_error',
      'created_at',
      'processed_at',
    )) as OperationStatusRow[];

  for (const row of operationRows) {
    const status = pendingStatusFromOperationRow(row);
    if (status && !latestByBillId.has(row.bill_id)) {
      latestByBillId.set(row.bill_id, status);
    }
  }

  for (const row of exportRows) {
    const status = pendingStatusFromExportRow(row);
    if (status && !latestByBillId.has(row.bill_id)) {
      latestByBillId.set(row.bill_id, status);
    }
  }

  for (const row of operationRows) {
    const status = errorStatusFromOperationRow(row);
    if (status && !latestByBillId.has(row.bill_id)) {
      latestByBillId.set(row.bill_id, status);
    }
  }

  for (const row of exportRows) {
    const status = errorStatusFromExportRow(row);
    if (status && !latestByBillId.has(row.bill_id)) {
      latestByBillId.set(row.bill_id, status);
    }
  }

  return uniqueBillIds.map((billId) =>
    latestByBillId.get(billId) ?? {
      bill_id: billId,
      state: 'not_exported',
      exported_at: null,
      external_ref: null,
      error_message: null,
    },
  );
}

/**
 * Retry one vendor bill by queueing the sync operation.
 * Idempotent: already-exported or already-pending bills return their existing status.
 * Requires billing:update.
 *
 * NOTE (dependency direction): inventory components cannot import billing actions —
 * the vendor-bills server page passes these as props to VendorBillsManager (ghost-usage idiom).
 */
export const retryVendorBillExport = withAuth(async (
  user,
  { tenant },
  billId: string
): Promise<VendorBillExportStatus | VendorBillExportActionError> => {
  if (!(await hasPermission(user, 'billing', 'update'))) {
    return permissionError('Permission denied: billing update required');
  }

  const { knex } = await createTenantKnex();
  const existing = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const statuses = await getVendorBillExportStatusesForTenant(trx, tenant, [billId]);
    if (statuses[0] && (statuses[0].state === 'exported' || statuses[0].state === 'pending')) {
      return statuses[0];
    }
    return null;
  });
  if (existing) {
    return existing;
  }

  const bill = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const row = await trx('vendor_bills')
      .where({ tenant, bill_id: billId })
      .first('bill_id');
    if (!row) {
      return false;
    }
    return true;
  });
  if (!bill) {
    return actionError('Vendor bill not found. It may have been updated or deleted. Please refresh and try again.');
  }

  await enqueueVendorBillExportRetry(knex, tenant, billId);

  const [status] = await withTransaction(knex, (trx: Knex.Transaction) =>
    getVendorBillExportStatusesForTenant(trx, tenant, [billId]),
  );
  return status;
});

/** @deprecated Use retryVendorBillExport. Kept as a compatibility alias for existing imports. */
export const exportVendorBillToAccounting = retryVendorBillExport;

/** Export statuses for a set of vendor bills (badge rendering, F047). Requires billing:read. */
export const getVendorBillExportStatuses = withAuth(async (
  user,
  { tenant },
  billIds: string[]
): Promise<VendorBillExportStatus[] | VendorBillExportActionError> => {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    return permissionError('Permission denied: billing read required');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx: Knex.Transaction) =>
    getVendorBillExportStatusesForTenant(trx, tenant, billIds),
  );
});

/** Export context for vendor-bill badge/retry UI. Requires billing:read. */
export const getVendorBillExportContext = withAuth(async (
  user,
  { tenant },
): Promise<VendorBillExportContext> => {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    throw new Error('Permission denied: billing read required');
  }

  const { knex } = await createTenantKnex();
  const integration = await resolveConnectedAccountingIntegration(knex, tenant);
  if (!integration) {
    return {
      integration: null,
      vendorBillsSupported: false,
    };
  }

  return {
    integration: {
      adapterType: integration.adapterType,
      label: labelForAdapter(integration.adapterType),
    },
    vendorBillsSupported: adapterSupportsExportType(integration.adapterType, 'vendor_bill'),
  };
});
