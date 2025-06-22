/**
 * Invoice API Controller
 * Comprehensive controller for all invoice-related operations
 * Integrates with InvoiceService and follows established patterns
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { InvoiceService } from '../services/InvoiceService';
import { 
  createInvoiceSchema,
  updateInvoiceSchema,
  invoiceListQuerySchema,
  manualInvoiceRequestSchema,
  finalizeInvoiceSchema,
  sendInvoiceSchema,
  applyCreditSchema,
  invoicePaymentSchema,
  bulkInvoiceStatusUpdateSchema,
  bulkInvoiceSendSchema,
  bulkInvoiceDeleteSchema,
  bulkInvoiceCreditSchema,
  taxCalculationRequestSchema,
  createRecurringInvoiceTemplateSchema,
  updateRecurringInvoiceTemplateSchema,
  invoicePreviewRequestSchema,
  generateInvoiceSchema
} from '../schemas/invoiceSchemas';
import { z } from 'zod';
import { compose } from '../middleware/compose';
import { withAuth } from '../middleware/apiMiddleware';
import { withPermission } from '../middleware/permissionMiddleware';
import { withValidation } from '../middleware/validationMiddleware';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';

export class InvoiceController extends BaseController {
  private invoiceService: InvoiceService;

  constructor() {
    super(null as any, null as any);
    this.invoiceService = new InvoiceService();
  }

  // ============================================================================
  // Core CRUD Operations
  // ============================================================================

  /**
   * GET /api/v1/invoices - List invoices with advanced filtering
   */
  list() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'read') as any,
      withValidation(invoiceListQuerySchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const { 
        page, 
        limit, 
        sort, 
        order, 
        include_items,
        include_company,
        include_billing_cycle,
        include_transactions,
        ...filters 
      } = query;
      
      const listOptions = { 
        page, 
        limit, 
        sort, 
        order,
        include_items: include_items === 'true',
        include_company: include_company === 'true',
        include_billing_cycle: include_billing_cycle === 'true',
        include_transactions: include_transactions === 'true'
      };
      
      const result = await this.invoiceService.list(listOptions, context, filters);
      
      const response = createApiResponse({
        data: result.data,
        pagination: {
          page: parseInt(page as string) || 1,
          limit: parseInt(limit as string) || 25,
          total: result.total,
          totalPages: Math.ceil(result.total / (parseInt(limit as string) || 25))
        },
        _links: {
          self: { href: `/api/v1/invoices` },
          create: { href: `/api/v1/invoices`, method: 'POST' },
          'create-manual': { href: `/api/v1/invoices/manual`, method: 'POST' },
          'generate-from-cycle': { href: `/api/v1/invoices/generate`, method: 'POST' },
          search: { href: `/api/v1/invoices/search` },
          export: { href: `/api/v1/invoices/export` },
          analytics: { href: `/api/v1/invoices/analytics` },
          'bulk-operations': { href: `/api/v1/invoices/bulk` },
          'recurring-templates': { href: `/api/v1/invoices/recurring-templates` },
          'tax-calculator': { href: `/api/v1/invoices/calculate-tax`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/invoices/{id} - Get invoice details with HATEOAS links
   */
  getById() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const url = new URL(req.url);
      const includeItems = url.searchParams.get('include_items') === 'true';
      const includeTransactions = url.searchParams.get('include_transactions') === 'true';
      const includeCompany = url.searchParams.get('include_company') === 'true';
      
      const options = {
        include_items: includeItems,
        include_transactions: includeTransactions,
        include_company: includeCompany
      };
      
      const invoice = await this.invoiceService.getById(id, context, options);
      
      if (!invoice) {
        return createErrorResponse('Invoice not found', 404);
      }

      const response = createApiResponse({
        data: invoice
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices - Create new invoice
   */
  create() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'create') as any,
      withValidation(createInvoiceSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const invoice = await this.invoiceService.create(data, context);
      
      const response = createApiResponse({
        data: invoice
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/invoices/{id} - Update invoice
   */
  update() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'update') as any,
      withValidation(updateInvoiceSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const invoice = await this.invoiceService.update(id, data, context);
      
      const response = createApiResponse({
        data: invoice
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/invoices/{id} - Delete invoice
   */
  delete() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.invoiceService.delete(id, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  // ============================================================================
  // Invoice Generation Endpoints
  // ============================================================================

  /**
   * POST /api/v1/invoices/generate - Generate invoice from billing cycle
   */
  generateFromBillingCycle() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'create') as any,
      withValidation(generateInvoiceSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { billing_cycle_id } = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const invoice = await this.invoiceService.generateFromBillingCycle(billing_cycle_id, context);
      
      const response = createApiResponse({
        data: invoice,
        message: 'Invoice generated successfully from billing cycle'
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/manual - Create manual invoice
   */
  createManualInvoice() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'create') as any,
      withValidation(manualInvoiceRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const invoice = await this.invoiceService.generateManualInvoice(data, context);
      
      const response = createApiResponse({
        data: invoice,
        message: 'Manual invoice created successfully'
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/preview - Preview invoice before generation
   */
  previewInvoice() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'read') as any,
      withValidation(invoicePreviewRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const preview = await this.invoiceService.previewInvoice(data, context);
      
      const response = createApiResponse({
        data: preview
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // Invoice Status Transition Endpoints
  // ============================================================================

  /**
   * POST /api/v1/invoices/{id}/finalize - Finalize invoice (draft → pending)
   */
  finalize() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'finalize') as any,
      withValidation(finalizeInvoiceSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const body = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const data = { ...body, invoice_id: id };
      const invoice = await this.invoiceService.finalize(data, context);
      
      const response = createApiResponse({
        data: invoice,
        message: 'Invoice finalized successfully'
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/{id}/send - Send invoice
   */
  send() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'send') as any,
      withValidation(sendInvoiceSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const body = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const data = { ...body, invoice_id: id };
      const result = await this.invoiceService.send(data, context);
      
      const response = createApiResponse({
        data: result
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/{id}/approve - Approve invoice
   */
  approve() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'approve') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const url = new URL(req.url);
      const executionId = url.searchParams.get('execution_id') || undefined;
      
      const result = await this.invoiceService.approve(id, context, executionId);
      
      const response = createApiResponse({
        data: result,
        message: 'Invoice approved successfully'
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/{id}/reject - Reject invoice
   */
  reject() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'reject') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const url = new URL(req.url);
      const reason = url.searchParams.get('reason') || 'No reason provided';
      const executionId = url.searchParams.get('execution_id') || undefined;
      
      const result = await this.invoiceService.reject(id, reason, context, executionId);
      
      const response = createApiResponse({
        data: result,
        message: 'Invoice rejected successfully'
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // Payment Processing Endpoints
  // ============================================================================

  /**
   * POST /api/v1/invoices/{id}/payments - Record payment against invoice
   */
  recordPayment() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'payment') as any,
      withValidation(invoicePaymentSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const body = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const data = { ...body, invoice_id: id };
      const result = await this.invoiceService.recordPayment(data, context);
      
      const response = createApiResponse({
        data: result,
        message: 'Payment recorded successfully'
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/{id}/credits - Apply credit to invoice
   */
  applyCredit() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'credit') as any,
      withValidation(applyCreditSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const body = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const data = { ...body, invoice_id: id };
      const result = await this.invoiceService.applyCredit(data, context);
      
      const response = createApiResponse({
        data: result,
        message: 'Credit applied successfully'
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // PDF Generation and Document Management
  // ============================================================================

  /**
   * GET /api/v1/invoices/{id}/pdf - Generate PDF for invoice
   */
  generatePDF() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'pdf') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.invoiceService.generatePDF(id, context);
      
      const response = createApiResponse({
        data: result,
        message: 'PDF generated successfully'
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/invoices/{id}/download - Download invoice PDF
   */
  downloadPDF() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'pdf') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.invoiceService.generatePDF(id, context);
      
      if (result.download_url) {
        return NextResponse.redirect(result.download_url);
      }
      
      return createErrorResponse('PDF download URL not available', 404);
    });
  }

  // ============================================================================
  // Tax Calculation Endpoints
  // ============================================================================

  /**
   * POST /api/v1/invoices/calculate-tax - Calculate tax for invoice items
   */
  calculateTax() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'tax') as any,
      withValidation(taxCalculationRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.invoiceService.calculateTax(data, context);
      
      const response = createApiResponse({
        data: result
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // Bulk Operations Endpoints
  // ============================================================================

  /**
   * PUT /api/v1/invoices/bulk/status - Bulk update invoice status
   */
  bulkUpdateStatus() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'bulk_update') as any,
      withValidation(bulkInvoiceStatusUpdateSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.invoiceService.bulkUpdateStatus(data, context);
      
      const response = createApiResponse({
        data: result,
        message: `Updated ${result.updated_count} invoices. ${result.errors.length} errors encountered.`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/bulk/send - Bulk send invoices
   */
  bulkSend() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'bulk_send') as any,
      withValidation(bulkInvoiceSendSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.invoiceService.bulkSend(data, context);
      
      const response = createApiResponse({
        data: result,
        message: `Sent ${result.sent_count} invoices. ${result.errors.length} errors encountered.`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/invoices/bulk - Bulk delete invoices
   */
  bulkDelete() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'bulk_delete') as any,
      withValidation(bulkInvoiceDeleteSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const result = await this.invoiceService.bulkDelete(data, context);
      
      const response = createApiResponse({
        data: result,
        message: `Deleted ${result.deleted_count} invoices. ${result.errors.length} errors encountered.`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/bulk/credit - Bulk apply credit to invoices
   */
  bulkApplyCredit() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'bulk_credit') as any,
      withValidation(bulkInvoiceCreditSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // Process each invoice individually for bulk credit application
      const results = [];
      const errors = [];
      
      for (const invoiceId of data.invoice_ids) {
        try {
          const creditData = {
            invoice_id: invoiceId,
            credit_amount: data.credit_amount_per_invoice
          };
          const result = await this.invoiceService.applyCredit(creditData, context);
          results.push({ invoice_id: invoiceId, ...result });
        } catch (error) {
          errors.push(`Error applying credit to invoice ${invoiceId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      const response = createApiResponse({
        data: { results, errors },
        message: `Applied credit to ${results.length} invoices. ${errors.length} errors encountered.`
      });

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // Search and Analytics Endpoints
  // ============================================================================

  /**
   * GET /api/v1/invoices/search - Advanced invoice search
   */
  search() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const url = new URL(req.url);
      const query = url.searchParams.get('q') || '';
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      
      const options = { page, limit };
      const invoices = await this.invoiceService.search(query, context, options);
      
      const response = createApiResponse({
        data: invoices.data,
        pagination: {
          page: page,
          limit: limit,
          total: invoices.total,
          totalPages: Math.ceil(invoices.total / limit)
        },
        _links: {
          self: { href: `/api/v1/invoices/search?q=${encodeURIComponent(query)}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/invoices/analytics - Get invoice analytics
   */
  getAnalytics() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'analytics') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const url = new URL(req.url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const dateRange = (from && to) ? { from, to } : undefined;
      
      const analytics = await this.invoiceService.getAnalytics(context, dateRange);
      
      const response = createApiResponse({
        data: analytics,
        _links: {
          self: { href: `/api/v1/invoices/analytics` },
          invoices: { href: `/api/v1/invoices` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/invoices/export - Export invoices
   */
  export() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      const url = new URL(req.url);
      const format = url.searchParams.get('format') || 'json';
      
      // For now, just return the invoices as JSON
      // In a real implementation, you'd generate CSV/Excel based on format
      const invoices = await this.invoiceService.list({}, context);
      
      if (format === 'csv') {
        const csvData = this.convertToCSV(invoices.data);
        return new NextResponse(csvData, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename=invoices.csv'
          }
        });
      }

      return NextResponse.json(createApiResponse({ data: invoices.data }));
    });
  }

  // ============================================================================
  // Recurring Invoice Management
  // ============================================================================

  /**
   * GET /api/v1/invoices/recurring-templates - List recurring invoice templates
   */
  listRecurringTemplates() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'recurring') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // This would typically call a method like:
      // const templates = await this.invoiceService.listRecurringTemplates(context);
      
      const response = createApiResponse({
        data: [], // Placeholder for now
        _links: {
          self: { href: `/api/v1/invoices/recurring-templates` },
          create: { href: `/api/v1/invoices/recurring-templates`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/recurring-templates - Create recurring invoice template
   */
  createRecurringTemplate() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'recurring') as any,
      withValidation(createRecurringInvoiceTemplateSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const template = await this.invoiceService.createRecurringTemplate(data, context);
      
      const response = createApiResponse({
        data: template,
        message: 'Recurring invoice template created successfully'
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/invoices/recurring-templates/{id} - Update recurring template
   */
  updateRecurringTemplate() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'recurring') as any,
      withValidation(updateRecurringInvoiceTemplateSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // This would typically call a method like:
      // const template = await this.invoiceService.updateRecurringTemplate(id, data, context);
      
      const response = createApiResponse({
        data: { template_id: id, ...data },
        message: 'Recurring invoice template updated successfully'
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/invoices/recurring-templates/{id} - Delete recurring template
   */
  deleteRecurringTemplate() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'recurring') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // This would typically call a method like:
      // await this.invoiceService.deleteRecurringTemplate(id, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  // ============================================================================
  // Invoice Items Management
  // ============================================================================

  /**
   * GET /api/v1/invoices/{id}/items - List invoice items
   */
  listItems() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const invoice = await this.invoiceService.getById(id, context, { include_items: true });
      
      if (!invoice) {
        return createErrorResponse('Invoice not found', 404);
      }
      
      const response = createApiResponse({
        data: (invoice as any).invoice_items || [],
        _links: {
          self: { href: `/api/v1/invoices/${id}/items` },
          parent: { href: `/api/v1/invoices/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/invoices/{id}/transactions - List invoice transactions
   */
  listTransactions() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const invoice = await this.invoiceService.getById(id, context, { include_transactions: true });
      
      if (!invoice) {
        return createErrorResponse('Invoice not found', 404);
      }
      
      const response = createApiResponse({
        data: (invoice as any).transactions || [],
        _links: {
          self: { href: `/api/v1/invoices/${id}/transactions` },
          parent: { href: `/api/v1/invoices/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/invoices/{id}/duplicate - Duplicate invoice
   */
  duplicate() {
    const middleware = compose(
      withAuth as any,
      withPermission('invoice', 'create') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const originalInvoice = await this.invoiceService.getById(id, context, { include_items: true });
      
      if (!originalInvoice) {
        return createErrorResponse('Invoice not found', 404);
      }
      
      // Create a new invoice based on the original
      const duplicateData = {
        company_id: originalInvoice.company_id,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
        subtotal: originalInvoice.subtotal,
        tax: originalInvoice.tax,
        total_amount: originalInvoice.total_amount,
        status: 'draft' as const,
        credit_applied: 0,
        is_manual: true,
        is_prepayment: false,
        items: (originalInvoice as any).invoice_items || []
      };
      
      const duplicatedInvoice = await this.invoiceService.create(duplicateData, context);
      
      const response = createApiResponse({
        data: duplicatedInvoice,
        message: 'Invoice duplicated successfully'
      }, 201);

      return NextResponse.json(response);
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Helper method to get validated query parameters
   */
  protected getValidatedQuery(req: NextRequest): any {
    // This would typically be implemented in the actual BaseController
    const url = new URL(req.url);
    const query: any = {};
    
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    
    return query;
  }

  /**
   * Helper method to get service context
   */
  protected getServiceContext(req: NextRequest): any {
    // This would typically be implemented in the actual BaseController
    // and extract user, tenant, etc. from the request
    return {
      userId: 'user-id', // Would be extracted from auth
      tenant: 'tenant-id', // Would be extracted from auth
      permissions: [] // Would be extracted from auth
    };
  }

  /**
   * Helper method to get path parameters
   */
  protected getPathParams(req: NextRequest): any {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    
    // Extract the ID from the path
    const id = pathParts[pathParts.length - 1];
    
    return { id };
  }

  /**
   * Helper method to get validated body
   */
  protected async getValidatedBody(req: NextRequest): Promise<any> {
    return await req.json();
  }

  /**
   * Helper method to convert data to CSV
   */
  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    );
    
    return [csvHeaders, ...csvRows].join('\n');
  }
}