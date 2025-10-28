import { NextRequest, NextResponse } from 'next/server';
import {
  createAccountingExportBatch,
  appendAccountingExportLines,
  appendAccountingExportErrors,
  updateAccountingExportBatchStatus,
  getAccountingExportBatch,
  listAccountingExportBatches,
  executeAccountingExportBatch
} from '../../actions/accountingExportActions';
import { CreateExportBatchInput, CreateExportLineInput, CreateExportErrorInput, UpdateExportBatchStatusInput } from '../../repositories/accountingExportRepository';
import { AccountingExportValidation } from '../../validation/accountingExportValidation';
import { AppError } from '../../errors';
import { AccountingExportInvoiceSelector } from '../../services/accountingExportInvoiceSelector';

const PREVIEW_LINE_LIMIT = 50;

export class ApiAccountingExportController {
  static async createBatch(req: NextRequest) {
    const body = (await req.json()) as CreateExportBatchInput;
    try {
      const batch = await createAccountingExportBatch(body);
      return NextResponse.json(batch, { status: 201 });
    } catch (error) {
      if (error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_DUPLICATE') {
        return NextResponse.json(
          {
            error: error.code,
            message: error.message,
            existingBatchId: error.details?.batchId,
            status: error.details?.status
          },
          { status: 409 }
        );
      }
      throw error;
    }
  }

  static async listBatches(req: NextRequest) {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? undefined;
    const adapter = url.searchParams.get('adapter_type') ?? undefined;
    const batches = await listAccountingExportBatches({
      status: status as any,
      adapter_type: adapter || undefined
    });
    return NextResponse.json(batches);
  }

  static async getBatch(req: NextRequest, { params }: { params: { batchId: string } }) {
    const data = await getAccountingExportBatch(params.batchId);
    if (!data.batch) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  static async preview(req: NextRequest) {
    const body = ((await req.json()) as { filters?: Record<string, unknown> }) ?? {};
    const filters = (body?.filters ?? {}) as Record<string, unknown>;

    const selector = await AccountingExportInvoiceSelector.create();
    const normalizedFilters = {
      startDate: typeof filters.startDate === 'string' && filters.startDate ? filters.startDate : undefined,
      endDate: typeof filters.endDate === 'string' && filters.endDate ? filters.endDate : undefined,
      invoiceStatuses: Array.isArray(filters.invoiceStatuses)
        ? (filters.invoiceStatuses as unknown[]).map((status) => String(status)).filter(Boolean)
        : typeof filters.invoiceStatuses === 'string'
          ? filters.invoiceStatuses
              .split(',')
              .map((status) => status.trim())
              .filter(Boolean)
          : undefined,
      clientIds: Array.isArray(filters.clientIds)
        ? (filters.clientIds as unknown[]).map((id) => String(id)).filter(Boolean)
        : undefined,
      clientSearch: typeof filters.clientSearch === 'string' && filters.clientSearch ? filters.clientSearch : undefined
    };

    const lines = await selector.previewInvoiceLines(normalizedFilters);
    const totalsByCurrency = lines.reduce<Record<string, number>>((acc, line) => {
      const currency = line.currencyCode || 'USD';
      const existing = acc[currency] ?? 0;
      acc[currency] = existing + line.amountCents;
      return acc;
    }, {});
    const invoiceCount = new Set(lines.map((line) => line.invoiceId)).size;

    const limitedLines = lines.slice(0, PREVIEW_LINE_LIMIT).map((line) => ({
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

    return NextResponse.json({
      invoiceCount,
      lineCount: lines.length,
      totalsByCurrency,
      lines: limitedLines,
      truncated: lines.length > limitedLines.length
    });
  }

  static async appendLines(req: NextRequest, { params }: { params: { batchId: string } }) {
    const body = (await req.json()) as { lines: CreateExportLineInput[] };
    const lines = await appendAccountingExportLines(params.batchId, body.lines);
    await AccountingExportValidation.ensureMappingsForBatch(params.batchId);
    return NextResponse.json(lines, { status: 201 });
  }

  static async appendErrors(req: NextRequest, { params }: { params: { batchId: string } }) {
    const body = (await req.json()) as { errors: CreateExportErrorInput[] };
    const errors = await appendAccountingExportErrors(params.batchId, body.errors);
    return NextResponse.json(errors, { status: 201 });
  }

  static async updateStatus(req: NextRequest, { params }: { params: { batchId: string } }) {
    const body = (await req.json()) as UpdateExportBatchStatusInput;
    const batch = await updateAccountingExportBatchStatus(params.batchId, body);
    if (!batch) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(batch);
  }

  static async execute(req: NextRequest, { params }: { params: { batchId: string } }) {
    try {
      const result = await executeAccountingExportBatch(params.batchId);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_INVALID_STATE') {
        return NextResponse.json(
          {
            error: error.code,
            message: error.message,
            status: error.details?.status
          },
          { status: 409 }
        );
      }
      throw error;
    }
  }
}
