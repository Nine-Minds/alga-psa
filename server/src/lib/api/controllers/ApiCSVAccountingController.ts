/**
 * CSV Accounting Export/Import Controller
 *
 * Handles CSV-specific accounting operations:
 * - CSV export generation for QuickBooks import
 * - Tax import from QuickBooks CSV reports
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { runWithTenant } from '../../db';
import { handleApiError, ForbiddenError, UnauthorizedError } from '../middleware/apiMiddleware';
import { BaseService, ListOptions } from './types';
import { getCSVTaxImportService } from '../../services/csvTaxImportService';
import { AccountingExportInvoiceSelector } from '../../services/accountingExportInvoiceSelector';
import { AccountingExportService } from '../../services/accountingExportService';
import { QuickBooksCSVAdapter } from '../../adapters/accounting/quickBooksCSVAdapter';
import { getSession } from '../../auth/getSession';
import { findUserById } from '../../actions/user-actions/userActions';
import logger from '@shared/core/logger';
import { AppError } from '../../errors';

type CSVAccountingPermission = 'export' | 'import';

const noopService: BaseService = {
  async list(_options: ListOptions): Promise<{ data: any[]; total: number }> {
    throw new Error('CSV accounting controller does not use base list service');
  },
  async getById(): Promise<any> {
    throw new Error('CSV accounting controller does not use base get service');
  },
  async create(): Promise<any> {
    throw new Error('CSV accounting controller does not use base create service');
  },
  async update(): Promise<any> {
    throw new Error('CSV accounting controller does not use base update service');
  },
  async delete(): Promise<void> {
    throw new Error('CSV accounting controller does not use base delete service');
  }
};

export class ApiCSVAccountingController extends ApiBaseController {
  constructor() {
    super(noopService, {
      // CSV integration is managed from the settings UI; use billing settings permissions
      // so MSP users who can manage mappings can also run CSV exports/imports.
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

  private async authorize(apiRequest: any, action: CSVAccountingPermission): Promise<void> {
    const user = apiRequest.context.user;
    if (user && user.user_type === 'client') {
      throw new ForbiddenError('Client portal users are not permitted to manage accounting exports');
    }
    // Treat both export/import as billing settings updates (same gate as mapping changes)
    await this.checkPermission(apiRequest, 'update');
  }

  /**
   * Generate a CSV export for QuickBooks import.
   */
  async exportCSV(req: NextRequest): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'export');

        const body = await apiRequest.json() as {
          filters?: {
            startDate?: string;
            endDate?: string;
            invoiceStatuses?: string[];
            clientIds?: string[];
          };
        };

        const filters = body.filters ?? {};

        logger.info('[ApiCSVAccountingController] Starting CSV export', {
          tenant: apiRequest.context.tenant,
          filters
        });

        // 1. Select invoices based on filters
        const selector = await AccountingExportInvoiceSelector.create();
        const lines = await selector.previewInvoiceLines({
          startDate: filters.startDate,
          endDate: filters.endDate,
          invoiceStatuses: filters.invoiceStatuses,
          clientIds: filters.clientIds,
          adapterType: QuickBooksCSVAdapter.TYPE,
          targetRealm: null,
          excludeSyncedInvoices: true
        });
        const invoiceCount = new Set(lines.map((l) => l.invoiceId)).size;
        logger.info('[ApiCSVAccountingController] CSV export selection complete', {
          tenant: apiRequest.context.tenant,
          invoiceCount,
          lineCount: lines.length
        });

        if (lines.length === 0) {
          logger.warn('[ApiCSVAccountingController] No invoices matched CSV export filters', {
            tenant: apiRequest.context.tenant,
            filters
          });
          return NextResponse.json(
            { error: 'no_invoices', message: 'No invoices match the specified filters' },
            { status: 400 }
          );
        }

        // 2. Persist batch + lines and execute through the unified accounting export service.
        const exportService = await AccountingExportService.create();
        let batchId: string;
        let createdNewBatch = false;

        try {
          const batch = await exportService.createBatch({
            adapter_type: QuickBooksCSVAdapter.TYPE,
            target_realm: null,
            export_type: 'invoice',
            filters: filters as Record<string, unknown>,
            created_by: apiRequest.context.userId
          });

          batchId = batch.batch_id;
          createdNewBatch = true;

          await exportService.appendLines(batchId, {
            lines: lines.map((line) => ({
              batch_id: batchId,
              invoice_id: line.invoiceId,
              invoice_charge_id: line.chargeId ?? null,
              client_id: null,
              amount_cents: line.amountCents,
              currency_code: line.currencyCode || 'USD',
              service_period_start: line.servicePeriodStart ?? null,
              service_period_end: line.servicePeriodEnd ?? null,
              status: 'pending'
            }))
          });
        } catch (error: any) {
          if (error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_DUPLICATE') {
            const existingBatchId = error.details?.batchId;
            if (!existingBatchId || typeof existingBatchId !== 'string') {
              throw error;
            }
            batchId = existingBatchId;
            createdNewBatch = false;
          } else {
            throw error;
          }
        }

        let deliveryResult;
        try {
          deliveryResult = await exportService.executeBatch(batchId);
        } catch (error: any) {
          const details = await exportService.getBatchWithDetails(batchId);
          const mappingErrors = details.errors
            .filter((e) => e.resolution_state === 'open')
            .map((e) => ({
            code: e.code,
            message: e.message,
            line_id: e.line_id,
            metadata: e.metadata ?? null
          }));

          logger.warn('[ApiCSVAccountingController] CSV export failed during batch execution', {
            tenant: apiRequest.context.tenant,
            batchId,
            status: details.batch?.status,
            error: error?.message,
            errorCount: mappingErrors.length
          });

          return NextResponse.json(
            {
              error: 'export_failed',
              message: error?.message ?? 'Export failed',
              batchId,
              status: details.batch?.status,
              errors: mappingErrors,
              reusedExistingBatch: !createdNewBatch
            },
            { status: 400 }
          );
        }

        const files = (deliveryResult.metadata as any)?.files ?? [];
        if (!Array.isArray(files) || files.length === 0) {
          return NextResponse.json(
            { error: 'export_failed', message: 'No CSV file was generated' },
            { status: 500 }
          );
        }

        const file = files[0];

        logger.info('[ApiCSVAccountingController] CSV export completed', {
          tenant: apiRequest.context.tenant,
          batchId,
          filename: file.filename,
          rowCount: deliveryResult.artifacts?.rowCount,
          invoiceCount
        });

        return new NextResponse(file.content, {
          status: 200,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            'X-Invoice-Count': String(invoiceCount),
            'X-Row-Count': String(deliveryResult.artifacts?.rowCount ?? 0),
            'X-Accounting-Export-Batch-Id': batchId
          }
        });
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  /**
   * Import tax data from a CSV file.
   */
  async importTax(req: NextRequest): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'import');

        // Parse multipart form data or JSON body
        const contentType = req.headers.get('content-type') || '';
        let csvContent: string;
        let startDate: Date;
        let endDate: Date;
        let dryRun = false;

        if (contentType.includes('multipart/form-data')) {
          const formData = await req.formData();
          const file = formData.get('file') as File | null;
          const startDateStr = formData.get('startDate') as string | null;
          const endDateStr = formData.get('endDate') as string | null;
          dryRun = formData.get('dryRun') === 'true';

          if (!file) {
            return NextResponse.json(
              { error: 'missing_file', message: 'CSV file is required' },
              { status: 400 }
            );
          }

          if (!startDateStr || !endDateStr) {
            return NextResponse.json(
              { error: 'missing_dates', message: 'Start date and end date are required' },
              { status: 400 }
            );
          }

          csvContent = await file.text();
          startDate = new Date(startDateStr);
          endDate = new Date(endDateStr);
        } else {
          // JSON body with base64 CSV content
          const body = await apiRequest.json() as {
            csvContent: string;
            startDate: string;
            endDate: string;
            dryRun?: boolean;
          };

          if (!body.csvContent) {
            return NextResponse.json(
              { error: 'missing_content', message: 'CSV content is required' },
              { status: 400 }
            );
          }

          if (!body.startDate || !body.endDate) {
            return NextResponse.json(
              { error: 'missing_dates', message: 'Start date and end date are required' },
              { status: 400 }
            );
          }

          csvContent = body.csvContent;
          startDate = new Date(body.startDate);
          endDate = new Date(body.endDate);
          dryRun = body.dryRun ?? false;
        }

        // Validate dates
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return NextResponse.json(
            { error: 'invalid_dates', message: 'Invalid date format' },
            { status: 400 }
          );
        }

        if (startDate > endDate) {
          return NextResponse.json(
            { error: 'invalid_date_range', message: 'Start date must be before end date' },
            { status: 400 }
          );
        }

        logger.info('[ApiCSVAccountingController] Starting CSV tax import', {
          tenant: apiRequest.context.tenant,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          dryRun,
          contentLength: csvContent.length
        });

        // Run import
        const service = getCSVTaxImportService();
        const result = await service.importTaxFromCSV({
          csvContent,
          startDate,
          endDate,
          userId: apiRequest.context.userId,
          dryRun
        });

        logger.info('[ApiCSVAccountingController] CSV tax import completed', {
          tenant: apiRequest.context.tenant,
          success: result.success,
          importId: result.importId,
          totalInvoices: result.summary.totalInvoices,
          successfulUpdates: result.summary.successfulUpdates,
          dryRun
        });

        return NextResponse.json(result);
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  /**
   * Validate a CSV file without importing.
   */
  async validateTax(req: NextRequest): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'import');

        const contentType = req.headers.get('content-type') || '';
        let csvContent: string;
        let startDate: Date;
        let endDate: Date;

        if (contentType.includes('multipart/form-data')) {
          const formData = await req.formData();
          const file = formData.get('file') as File | null;
          const startDateStr = formData.get('startDate') as string | null;
          const endDateStr = formData.get('endDate') as string | null;

          if (!file) {
            return NextResponse.json(
              { error: 'missing_file', message: 'CSV file is required' },
              { status: 400 }
            );
          }

          if (!startDateStr || !endDateStr) {
            return NextResponse.json(
              { error: 'missing_dates', message: 'Start date and end date are required' },
              { status: 400 }
            );
          }

          csvContent = await file.text();
          startDate = new Date(startDateStr);
          endDate = new Date(endDateStr);
        } else {
          const body = await apiRequest.json() as {
            csvContent: string;
            startDate: string;
            endDate: string;
          };

          if (!body.csvContent || !body.startDate || !body.endDate) {
            return NextResponse.json(
              { error: 'missing_fields', message: 'CSV content, start date, and end date are required' },
              { status: 400 }
            );
          }

          csvContent = body.csvContent;
          startDate = new Date(body.startDate);
          endDate = new Date(body.endDate);
        }

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return NextResponse.json(
            { error: 'invalid_dates', message: 'Invalid date format' },
            { status: 400 }
          );
        }

        const service = getCSVTaxImportService();
        const validation = await service.validateOnly(csvContent, startDate, endDate);

        return NextResponse.json(validation);
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  /**
   * Get CSV tax import history.
   */
  async getImportHistory(req: NextRequest): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'import');

        const url = new URL(apiRequest.url);
        const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

        const service = getCSVTaxImportService();
        const history = await service.getImportHistory(Math.min(limit, 100));

        return NextResponse.json(history);
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  /**
   * Rollback a CSV tax import.
   */
  async rollbackImport(req: NextRequest, params: { importId: string }): Promise<NextResponse> {
    try {
      const apiRequest = await this.authenticate(req);
      apiRequest.params = params;

      return await runWithTenant(apiRequest.context.tenant, async () => {
        await this.authorize(apiRequest, 'import');

        const service = getCSVTaxImportService();
        const result = await service.rollbackImport(params.importId, apiRequest.context.userId);

        if (!result.success) {
          return NextResponse.json(
            { error: 'rollback_failed', message: result.error },
            { status: 400 }
          );
        }

        return NextResponse.json(result);
      });
    } catch (error) {
      return handleApiError(error);
    }
  }

  /**
   * Download a tax import template CSV.
   */
  async getTemplate(_req: NextRequest): Promise<NextResponse> {
    // Template CSV with headers and example row
    const templateContent = `InvoiceNo,InvoiceDate,TaxAmount,TaxCode,TaxRate
INV-001,12/01/2024,125.50,TAX,10
INV-002,12/02/2024,87.25,TAX,10`;

    return new NextResponse(templateContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="tax-import-template.csv"'
      }
    });
  }
}
