import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import {
  createAccountingExportBatch,
  appendAccountingExportLines,
  appendAccountingExportErrors,
  updateAccountingExportBatchStatus,
  getAccountingExportBatch,
  listAccountingExportBatches,
  executeAccountingExportBatch
} from '../../actions/accountingExportActions';
import {
  CreateExportBatchInput,
  CreateExportLineInput,
  CreateExportErrorInput,
  UpdateExportBatchStatusInput
} from '../../repositories/accountingExportRepository';
import { AccountingExportValidation } from '../../validation/accountingExportValidation';
import { AppError } from '../../errors';
import { AccountingExportInvoiceSelector } from '../../services/accountingExportInvoiceSelector';
import { runWithTenant } from '../../db';
import {
  AuthenticatedApiRequest,
  ForbiddenError,
  handleApiError
} from '../middleware/apiMiddleware';
import { BaseService, ListOptions } from './types';

const PREVIEW_LINE_LIMIT = 50;

type AccountingExportPermission = 'create' | 'read' | 'update' | 'execute';

const noopService: BaseService = {
  async list(_options: ListOptions): Promise<{ data: any[]; total: number }> {
    throw new Error('Accounting export controller does not use base list service');
  },
  async getById(): Promise<any> {
    throw new Error('Accounting export controller does not use base get service');
  },
  async create(): Promise<any> {
    throw new Error('Accounting export controller does not use base create service');
  },
  async update(): Promise<any> {
    throw new Error('Accounting export controller does not use base update service');
  },
  async delete(): Promise<void> {
    throw new Error('Accounting export controller does not use base delete service');
  }
};

export class ApiAccountingExportController extends ApiBaseController {
  constructor() {
    super(noopService, {
      resource: 'accountingExports'
    });
  }

  private async authorize(apiRequest: AuthenticatedApiRequest, action: AccountingExportPermission): Promise<void> {
    const user = apiRequest.context.user;
    if (user && user.user_type === 'client') {
      throw new ForbiddenError('Client portal users are not permitted to manage accounting exports');
    }
    await this.checkPermission(apiRequest, action);
  }

  async createBatch(req: NextRequest): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'create');

        const body = (await apiRequest.json()) as CreateExportBatchInput;
        try {
          const batch = await createAccountingExportBatch({
            ...body,
            created_by: body.created_by ?? apiRequest.context.userId
          }, { user: apiRequest.context.user });
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
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  async listBatches(req: NextRequest): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'read');

        const url = new URL(apiRequest.url);
        const status = url.searchParams.get('status') ?? undefined;
        const adapter = url.searchParams.get('adapter_type') ?? undefined;

        const batches = await listAccountingExportBatches({
          status: status as any,
          adapter_type: adapter || undefined
        }, { user: apiRequest.context.user });

        return NextResponse.json(batches);
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  async getBatch(req: NextRequest, params: { batchId: string }): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      apiRequest.params = params;

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'read');

        const data = await getAccountingExportBatch(params.batchId, { user: apiRequest.context.user });

        if (!data.batch) {
          return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }

        return NextResponse.json(data);
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  async preview(req: NextRequest): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'read');

        const body = ((await apiRequest.json()) as { filters?: Record<string, unknown> }) ?? {};
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
          clientSearch: typeof filters.clientSearch === 'string' && filters.clientSearch ? filters.clientSearch : undefined,
          adapterType: typeof filters.adapterType === 'string' && filters.adapterType ? filters.adapterType : undefined,
          targetRealm: typeof filters.targetRealm === 'string' && filters.targetRealm ? filters.targetRealm : undefined,
          excludeSyncedInvoices: true
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
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  async appendLines(req: NextRequest, params: { batchId: string }): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      apiRequest.params = params;

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'update');

        const body = (await apiRequest.json()) as { lines: CreateExportLineInput[] };
        const lines = await appendAccountingExportLines(params.batchId, body.lines, { user: apiRequest.context.user });

        await AccountingExportValidation.ensureMappingsForBatch(params.batchId);
        return NextResponse.json(lines, { status: 201 });
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  async appendErrors(req: NextRequest, params: { batchId: string }): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      apiRequest.params = params;

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'update');

        const body = (await apiRequest.json()) as { errors: CreateExportErrorInput[] };
        const errors = await appendAccountingExportErrors(params.batchId, body.errors, { user: apiRequest.context.user });

        return NextResponse.json(errors, { status: 201 });
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  async updateStatus(req: NextRequest, params: { batchId: string }): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      apiRequest.params = params;

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'update');

        const body = (await apiRequest.json()) as UpdateExportBatchStatusInput;
        const batch = await updateAccountingExportBatchStatus(params.batchId, body, { user: apiRequest.context.user });

        if (!batch) {
          return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }

        return NextResponse.json(batch);
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  async execute(req: NextRequest, params: { batchId: string }): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      apiRequest.params = params;

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'execute');

        try {
          const result = await executeAccountingExportBatch(params.batchId, { user: apiRequest.context.user });

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
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
}
