'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { AccountingExportService } from '../services/accountingExportService';
import { resolveDefaultRealm } from '../services/accountingSync/accountingSyncSettings';
import type { Knex } from 'knex';
import type { VendorBillExportStatus } from '@alga-psa/inventory/lib/integrationTypes';

export type { VendorBillExportStatus, VendorBillExportState } from '@alga-psa/inventory/lib/integrationTypes';

type ExportStatusRow = {
  bill_id: string;
  line_status: string | null;
  batch_status: string | null;
  external_document_ref: string | null;
  line_notes: string | null;
  batch_notes: string | null;
  delivered_at: string | Date | null;
  line_updated_at: string | Date | null;
  batch_updated_at: string | Date | null;
};

type MappingStatusRow = {
  bill_id: string;
  external_ref: string | null;
  last_synced_at: string | Date | null;
};

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function statusFromExportRow(row: ExportStatusRow): VendorBillExportStatus {
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

  if (lineStatus === 'failed' || batchStatus === 'failed' || batchStatus === 'needs_attention') {
    return {
      bill_id: row.bill_id,
      state: 'error',
      exported_at: null,
      external_ref: externalRef,
      error_message: row.line_notes ?? row.batch_notes ?? 'Vendor bill export failed',
    };
  }

  return {
    bill_id: row.bill_id,
    state: 'pending',
    exported_at: null,
    external_ref: externalRef,
    error_message: null,
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
    .whereIn('line.invoice_id', uniqueBillIds)
    .orderBy('line.created_at', 'desc')
    .select(
      'line.invoice_id as bill_id',
      'line.status as line_status',
      'batch.status as batch_status',
      'line.external_document_ref',
      'line.notes as line_notes',
      'batch.notes as batch_notes',
      'batch.delivered_at',
      'line.updated_at as line_updated_at',
      'batch.updated_at as batch_updated_at',
    )) as ExportStatusRow[];

  const latestByBillId = new Map<string, VendorBillExportStatus>();
  for (const row of exportRows) {
    if (!latestByBillId.has(row.bill_id)) {
      latestByBillId.set(row.bill_id, statusFromExportRow(row));
    }
  }

  const missingBillIds = uniqueBillIds.filter((billId) => !latestByBillId.has(billId));
  if (missingBillIds.length > 0) {
    const mappingRows = (await trx('tenant_external_entity_mappings')
      .where({
        tenant,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'vendor_bill',
      })
      .whereIn('alga_entity_id', missingBillIds)
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
 * Export one vendor bill through the accounting export engine (F045/F046, QBO adapter).
 * Idempotent: re-export of an already-exported bill returns its existing status.
 * Requires billing:update.
 *
 * NOTE (dependency direction): inventory components cannot import billing actions —
 * the vendor-bills server page passes these as props to VendorBillsManager (ghost-usage idiom).
 */
export const exportVendorBillToAccounting = withAuth(async (
  user,
  { tenant },
  billId: string
): Promise<VendorBillExportStatus> => {
  if (!(await hasPermission(user, 'billing', 'update'))) {
    throw new Error('Permission denied: billing update required');
  }

  const { knex } = await createTenantKnex();
  const existing = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const statuses = await getVendorBillExportStatusesForTenant(trx, tenant, [billId]);
    if (statuses[0] && statuses[0].state !== 'not_exported') {
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
      .first('bill_id', 'total_amount', 'currency_code', 'bill_number');
    if (!row) {
      throw new Error('Vendor bill not found');
    }
    return row as { bill_id: string; total_amount: string | number; currency_code: string | null; bill_number: string };
  });

  const targetRealm = await resolveDefaultRealm(knex, tenant);
  const exportService = await AccountingExportService.createForTenant(tenant);
  const batch = await exportService.createBatch({
    adapter_type: 'quickbooks_online',
    export_type: 'vendor_bill',
    target_realm: targetRealm,
    filters: { billIds: [billId] },
    created_by: user.user_id ?? null,
    notes: `Vendor bill export: ${bill.bill_number}`,
    origin: 'manual',
  });

  await exportService.appendLines(batch.batch_id, {
    lines: [{
      batch_id: batch.batch_id,
      invoice_id: billId,
      invoice_charge_id: null,
      client_id: null,
      amount_cents: Math.round(Number(bill.total_amount ?? 0)),
      currency_code: bill.currency_code ?? 'USD',
      payload: {
        invoice_number: bill.bill_number,
        invoice_status: 'vendor_bill',
        metadata: {
          manual_invoice: true,
        },
      },
    }],
  });

  await exportService.executeBatch(batch.batch_id);

  const [status] = await withTransaction(knex, (trx: Knex.Transaction) =>
    getVendorBillExportStatusesForTenant(trx, tenant, [billId]),
  );
  return status;
});

/** Export statuses for a set of vendor bills (badge rendering, F047). Requires billing:read. */
export const getVendorBillExportStatuses = withAuth(async (
  user,
  { tenant },
  billIds: string[]
): Promise<VendorBillExportStatus[]> => {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    throw new Error('Permission denied: billing read required');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx: Knex.Transaction) =>
    getVendorBillExportStatusesForTenant(trx, tenant, billIds),
  );
});
