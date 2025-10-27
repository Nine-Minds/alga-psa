import { NextRequest, NextResponse } from 'next/server';
import {
  createAccountingExportBatch,
  appendAccountingExportLines,
  appendAccountingExportErrors,
  updateAccountingExportBatchStatus,
  getAccountingExportBatch,
  listAccountingExportBatches
} from '../../actions/accountingExportActions';
import { CreateExportBatchInput, CreateExportLineInput, CreateExportErrorInput, UpdateExportBatchStatusInput } from '../../lib/repositories/accountingExportRepository';

export class ApiAccountingExportController {
  static async createBatch(req: NextRequest) {
    const body = (await req.json()) as CreateExportBatchInput;
    const batch = await createAccountingExportBatch(body);
    return NextResponse.json(batch, { status: 201 });
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

  static async appendLines(req: NextRequest, { params }: { params: { batchId: string } }) {
    const body = (await req.json()) as { lines: CreateExportLineInput[] };
    const lines = await appendAccountingExportLines(params.batchId, body.lines);
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
}
