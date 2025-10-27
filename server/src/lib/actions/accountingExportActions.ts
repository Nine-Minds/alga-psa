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

export async function createAccountingExportBatch(input: CreateExportBatchInput): Promise<AccountingExportBatch> {
  const service = await AccountingExportService.create();
  return service.createBatch(input);
}

export async function appendAccountingExportLines(batchId: string, lines: CreateExportLineInput[]): Promise<AccountingExportLine[]> {
  const service = await AccountingExportService.create();
  return service.appendLines(batchId, { lines });
}

export async function appendAccountingExportErrors(batchId: string, errors: CreateExportErrorInput[]): Promise<AccountingExportError[]> {
  const service = await AccountingExportService.create();
  return service.appendErrors(batchId, { errors });
}

export async function updateAccountingExportBatchStatus(batchId: string, updates: UpdateExportBatchStatusInput): Promise<AccountingExportBatch | null> {
  const service = await AccountingExportService.create();
  return service.updateBatchStatus(batchId, updates);
}

export async function getAccountingExportBatch(batchId: string): Promise<{
  batch: AccountingExportBatch | null;
  lines: AccountingExportLine[];
  errors: AccountingExportError[];
}> {
  const service = await AccountingExportService.create();
  return service.getBatchWithDetails(batchId);
}

export async function listAccountingExportBatches(params: { status?: AccountingExportStatus; adapter_type?: string } = {}): Promise<AccountingExportBatch[]> {
  const service = await AccountingExportService.create();
  return service.listBatches(params);
}

export async function executeAccountingExportBatch(batchId: string): Promise<AccountingExportDeliveryResult> {
  const service = await AccountingExportService.create();
  return service.executeBatch(batchId);
}
