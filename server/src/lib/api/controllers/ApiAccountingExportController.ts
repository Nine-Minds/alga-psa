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
} from '@alga-psa/billing/actions';
import {
  CreateExportBatchInput,
  CreateExportLineInput,
  CreateExportErrorInput,
  UpdateExportBatchStatusInput
} from '../../repositories/accountingExportRepository';
import { AccountingExportValidation } from '../../validation/accountingExportValidation';
import { AppError } from '../../errors';
import { AccountingExportInvoiceSelector } from '../../services/accountingExportInvoiceSelector';
import { runWithTenant, createTenantKnex } from '../../db';
import {
  AuthenticatedApiRequest,
  ForbiddenError,
  handleApiError
} from '../middleware/apiMiddleware';
import { BaseService, ListOptions } from './types';
import { getSession } from '../../auth/getSession';
import { findUserById } from '@alga-psa/users/actions';
import { UnauthorizedError } from '../middleware/apiMiddleware';

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
      // Align with accounting mappings + CSV export permissions; treat exports as billing settings management for now.
      resource: 'billing_settings'
    });
  }

  protected override async authenticate(req: NextRequest): Promise<any> {
    const apiKey = req.headers.get('x-api-key');
    if (apiKey) {
      return super.authenticate(req);
    }

    const session = await getSession();
    const sessionUser = session?.user as any;
    const tenant = typeof sessionUser?.tenant === 'string' ? sessionUser.tenant : null;
    const userId = typeof sessionUser?.id === 'string' ? sessionUser.id : null;

    if (!tenant || !userId) {
      throw new UnauthorizedError('Unauthorized');
    }

    const user = await findUserById(userId);
    if (!user) {
      throw new UnauthorizedError('Unauthorized');
    }

    const apiRequest = req as any;
    apiRequest.context = {
      userId,
      tenant,
      user
    };
    return apiRequest;
  }

  private async authorize(apiRequest: AuthenticatedApiRequest, action: AccountingExportPermission): Promise<void> {
    const user = apiRequest.context.user;
    if (user && user.user_type === 'client') {
      throw new ForbiddenError('Client portal users are not permitted to manage accounting exports');
    }
    await this.checkPermission(apiRequest, action === 'read' ? 'read' : 'update');
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

  async resetInvoiceExportLock(req: NextRequest): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'update');

        const body = (await apiRequest.json()) as {
          invoiceId?: string;
          invoiceNumber?: string;
          batchId?: string;
          adapterType: string;
        };

        const adapterType = typeof body.adapterType === 'string' ? body.adapterType.trim() : '';
        if (!adapterType) {
          return NextResponse.json(
            { error: 'validation_error', message: 'adapterType is required' },
            { status: 400 }
          );
        }

        const invoiceNumber = typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim() : '';
        let invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId.trim() : '';
        const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : '';

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
          return NextResponse.json(
            { error: 'tenant_required', message: 'Tenant context required' },
            { status: 400 }
          );
        }

        if (batchId) {
          const batch = await knex('accounting_export_batches')
            .select('batch_id', 'adapter_type', 'target_realm', 'status')
            .where({ tenant, batch_id: batchId })
            .first();

          if (!batch) {
            return NextResponse.json(
              { error: 'not_found', message: `Export batch ${batchId} not found` },
              { status: 404 }
            );
          }

          if (String(batch.adapter_type) !== adapterType) {
            return NextResponse.json(
              { error: 'validation_error', message: `Batch adapter_type is ${batch.adapter_type}, expected ${adapterType}` },
              { status: 400 }
            );
          }

          const lineInvoiceIds = await knex('accounting_export_lines')
            .distinct('invoice_id')
            .where({ tenant, batch_id: batchId })
            .whereNotNull('invoice_id');

          const invoiceIds = lineInvoiceIds.map((row: any) => row.invoice_id).filter(Boolean);
          if (invoiceIds.length === 0) {
            return NextResponse.json({
              success: true,
              adapterType,
              batchId,
              targetRealm: batch.target_realm ?? null,
              invoiceCount: 0,
              cleared: 0
            });
          }

          const deletedCount = await knex('tenant_external_entity_mappings')
            .where({
              tenant,
              integration_type: adapterType,
              alga_entity_type: 'invoice'
            })
            .whereIn('alga_entity_id', invoiceIds.map((id: string) => String(id)))
            .modify((qb) => {
              if (batch.target_realm) {
                qb.andWhere((builder) => {
                  builder.where('external_realm_id', batch.target_realm).orWhereNull('external_realm_id');
                });
              } else {
                qb.andWhere((builder) => builder.whereNull('external_realm_id'));
              }
            })
            .del();

          return NextResponse.json({
            success: true,
            adapterType,
            batchId,
            targetRealm: batch.target_realm ?? null,
            invoiceCount: invoiceIds.length,
            cleared: deletedCount
          });
        }

        if (!invoiceId) {
          if (!invoiceNumber) {
            return NextResponse.json(
              { error: 'validation_error', message: 'invoiceId, invoiceNumber, or batchId is required' },
              { status: 400 }
            );
          }

          const invoice = await knex('invoices')
            .select('invoice_id')
            .where({ tenant, invoice_number: invoiceNumber })
            .first();

          if (!invoice?.invoice_id) {
            return NextResponse.json(
              { error: 'not_found', message: `Invoice ${invoiceNumber} not found` },
              { status: 404 }
            );
          }

          invoiceId = invoice.invoice_id;
        }

        const deletedCount = await knex('tenant_external_entity_mappings')
          .where({
            tenant,
            integration_type: adapterType,
            alga_entity_type: 'invoice',
            alga_entity_id: invoiceId
          })
          .del();

        return NextResponse.json({
          success: true,
          adapterType,
          invoiceId,
          invoiceNumber: invoiceNumber || null,
          cleared: deletedCount
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
          if (error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_EMPTY_BATCH') {
            return NextResponse.json(
              {
                error: error.code,
                message: error.message
              },
              { status: 400 }
            );
          }
          throw error;
        }
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  async downloadFile(req: NextRequest, params: { batchId: string }): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      apiRequest.params = params;

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'execute');

        try {
          const result = await executeAccountingExportBatch(params.batchId, { user: apiRequest.context.user });
          const files = (result.metadata as any)?.files ?? [];

          if (!Array.isArray(files) || files.length === 0) {
            return NextResponse.json(
              { error: 'ACCOUNTING_EXPORT_NO_FILE', message: 'No file was generated for this batch.' },
              { status: 400 }
            );
          }

          const file = files[0];
          const filename = typeof file.filename === 'string' && file.filename ? file.filename : 'accounting-export.csv';
          const contentType = typeof file.contentType === 'string' && file.contentType ? file.contentType : 'text/csv';
          const content = typeof file.content === 'string' ? file.content : '';

          return new NextResponse(content, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Disposition': `attachment; filename="${filename}"`,
              'X-Accounting-Export-Batch-Id': params.batchId
            }
          });
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
          if (error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_EMPTY_BATCH') {
            return NextResponse.json(
              {
                error: error.code,
                message: error.message
              },
              { status: 400 }
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
