/**
 * API Invoice Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { InvoiceService } from '@product/api/services/InvoiceService';
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
} from '@product/api/schemas/invoiceSchemas';
import { 
  ApiKeyServiceForApi 
} from '@server/lib/services/apiKeyServiceForApi';
import { 
  findUserByIdForApi 
} from '@product/actions/user-actions/findUserByIdForApi';
import { 
  runWithTenant 
} from '@server/lib/db';
import { 
  getConnection 
} from '@server/lib/db/db';
import { 
  hasPermission 
} from '@server/lib/auth/rbac';
import {
  ApiRequest,
  AuthenticatedApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiInvoiceController extends ApiBaseController {
  private invoiceService: InvoiceService;

  constructor() {
    const invoiceService = new InvoiceService();
    
    super(invoiceService, {
      resource: 'invoice',
      createSchema: createInvoiceSchema,
      updateSchema: updateInvoiceSchema,
      querySchema: invoiceListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.invoiceService = invoiceService;
  }

  /**
   * Override list to add invoice-specific query parameters
   */
  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Parse query parameters
          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          const sort = url.searchParams.get('sort') || 'created_at';
          const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';
          
          // Invoice-specific includes
          const include_items = url.searchParams.get('include_items') === 'true';
          const include_client = url.searchParams.get('include_client') === 'true';
          const include_billing_cycle = url.searchParams.get('include_billing_cycle') === 'true';
          const include_transactions = url.searchParams.get('include_transactions') === 'true';

          // Get filters
          const filters: any = {};
          url.searchParams.forEach((value, key) => {
            if (!['page', 'limit', 'sort', 'order', 'include_items', 'include_client', 'include_billing_cycle', 'include_transactions'].includes(key)) {
              filters[key] = value;
            }
          });

          const listOptions = { 
            page, 
            limit, 
            sort, 
            order,
            include_items,
            include_client,
            include_billing_cycle,
            include_transactions
          };

          const result = await this.invoiceService.list(listOptions, apiRequest.context, filters);
          
          return createPaginatedResponse(
            result.data,
            result.total,
            page,
            limit,
            { sort, order, filters }
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Override getById to add invoice-specific includes
   */
  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const url = new URL(apiRequest.url);
          const includeItems = url.searchParams.get('include_items') === 'true';
          const includeTransactions = url.searchParams.get('include_transactions') === 'true';
          const includeClient = url.searchParams.get('include_client') === 'true';
          
          const options = {
            include_items: includeItems,
            include_transactions: includeTransactions,
            include_client: includeClient
          };
          
          const invoice = await this.invoiceService.getById(id, apiRequest.context, options);
          
          if (!invoice) {
            throw new NotFoundError('Invoice not found');
          }
          
          return createSuccessResponse(invoice);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Generate invoice from billing cycle
   */
  generateFromBillingCycle() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          // Validate request body
          const body = await req.json();
          const data = generateInvoiceSchema.parse(body);
          
          const invoice = await this.invoiceService.generateFromBillingCycle(
            data.billing_cycle_id, 
            apiRequest.context
          );
          
          return createSuccessResponse(invoice, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create manual invoice
   */
  createManualInvoice() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          // Validate request body
          const body = await req.json();
          const data = manualInvoiceRequestSchema.parse(body);
          
          const invoice = await this.invoiceService.generateManualInvoice(data, apiRequest.context);
          
          return createSuccessResponse(invoice, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Preview invoice
   */
  previewInvoice() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          // Validate request body
          const body = await req.json();
          const data = invoicePreviewRequestSchema.parse(body);
          
          const preview = await this.invoiceService.previewInvoice(data, apiRequest.context);
          
          return createSuccessResponse(preview);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Finalize invoice
   */
  finalize() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'finalize');

          const id = await this.extractIdFromPath(apiRequest);
          
          // Validate request body
          const body = await req.json().catch(() => ({}));
          const data = finalizeInvoiceSchema.parse({ ...body, invoice_id: id });
          
          const invoice = await this.invoiceService.finalize(data, apiRequest.context);
          
          return createSuccessResponse(invoice);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Send invoice
   */
  send() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'send');

          const id = await this.extractIdFromPath(apiRequest);
          
          // Validate request body
          const body = await req.json();
          const data = sendInvoiceSchema.parse({ ...body, invoice_id: id });
          
          const result = await this.invoiceService.send(data, apiRequest.context);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Approve invoice
   */
  approve() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'approve');

          const id = await this.extractIdFromPath(apiRequest);
          
          const url = new URL(apiRequest.url);
          const executionId = url.searchParams.get('execution_id') || undefined;
          
          const result = await this.invoiceService.approve(id, apiRequest.context, executionId);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Reject invoice
   */
  reject() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'reject');

          const id = await this.extractIdFromPath(apiRequest);
          
          const url = new URL(apiRequest.url);
          const reason = url.searchParams.get('reason') || 'No reason provided';
          const executionId = url.searchParams.get('execution_id') || undefined;
          
          const result = await this.invoiceService.reject(id, reason, apiRequest.context, executionId);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Record payment
   */
  recordPayment() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'payment');

          const id = await this.extractIdFromPath(apiRequest);
          
          // Validate request body
          const body = await req.json();
          const data = invoicePaymentSchema.parse({ ...body, invoice_id: id });
          
          const result = await this.invoiceService.recordPayment(data, apiRequest.context);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Apply credit
   */
  applyCredit() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'credit');

          const id = await this.extractIdFromPath(apiRequest);
          
          // Validate request body
          const body = await req.json();
          const data = applyCreditSchema.parse({ ...body, invoice_id: id });
          
          const result = await this.invoiceService.applyCredit(data, apiRequest.context);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Generate PDF
   */
  generatePDF() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'pdf');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.invoiceService.generatePDF(id, apiRequest.context);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Download PDF
   */
  downloadPDF() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'pdf');

          const id = await this.extractIdFromPath(apiRequest);
          
          const result = await this.invoiceService.generatePDF(id, apiRequest.context);
          
          if (result.download_url) {
            return NextResponse.redirect(result.download_url);
          }
          
          throw new NotFoundError('PDF download URL not available');
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Calculate tax
   */
  calculateTax() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions - tax operations require billing permissions
          await this.checkPermission(apiRequest, 'billing');

          // Validate request body
          const body = await req.json();
          const data = taxCalculationRequestSchema.parse(body);
          
          const result = await this.invoiceService.calculateTax(data, apiRequest.context);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk update status
   */
  bulkUpdateStatus() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'bulk_update');

          // Validate request body
          const body = await req.json();
          const data = bulkInvoiceStatusUpdateSchema.parse(body);
          
          const result = await this.invoiceService.bulkUpdateStatus(data, apiRequest.context);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk send
   */
  bulkSend() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'bulk_send');

          // Validate request body
          const body = await req.json();
          const data = bulkInvoiceSendSchema.parse(body);
          
          const result = await this.invoiceService.bulkSend(data, apiRequest.context);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk delete
   */
  bulkDelete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'bulk_delete');

          // Validate request body
          const body = await req.json();
          const data = bulkInvoiceDeleteSchema.parse(body);
          
          const result = await this.invoiceService.bulkDeleteInvoices(data, apiRequest.context);
          
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk apply credit
   */
  bulkApplyCredit() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'bulk_credit');

          // Validate request body
          const body = await req.json();
          const data = bulkInvoiceCreditSchema.parse(body);
          
          // Process each invoice individually
          const results: any[] = [];
          const errors: string[] = [];
          
          for (const invoiceId of data.invoice_ids) {
            try {
              const creditData = {
                invoice_id: invoiceId,
                credit_amount: data.credit_amount_per_invoice
              };
              const result = await this.invoiceService.applyCredit(creditData, apiRequest.context);
              results.push({ ...result, invoice_id: invoiceId });
            } catch (error) {
              errors.push(`Error applying credit to invoice ${invoiceId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }
          
          return createSuccessResponse({ results, errors });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Search invoices
   */
  search() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const query = url.searchParams.get('q') || '';
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          
          const options = { page, limit };
          const invoices = await this.invoiceService.search(query, apiRequest.context, options);
          
          return createPaginatedResponse(
            invoices.data,
            invoices.total,
            page,
            limit
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get analytics
   */
  getAnalytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'analytics');

          const url = new URL(apiRequest.url);
          const from = url.searchParams.get('from');
          const to = url.searchParams.get('to');
          const dateRange = (from && to) ? { from, to } : undefined;
          
          const analytics = await this.invoiceService.getAnalytics(apiRequest.context, dateRange);
          
          return createSuccessResponse(analytics);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Export invoices
   */
  export() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const format = url.searchParams.get('format') || 'json';
          
          const invoices = await this.invoiceService.list({}, apiRequest.context);
          
          if (format === 'csv') {
            const csvData = this.convertToCSV(invoices.data);
            return new NextResponse(csvData, {
              headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': 'attachment; filename=invoices.csv'
              }
            });
          }

          return createSuccessResponse(invoices.data);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List recurring templates
   */
  listRecurringTemplates() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'recurring');

          // TODO: Implement recurring template listing
          return createSuccessResponse([]);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create recurring template
   */
  createRecurringTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'recurring');

          // Validate request body
          const body = await req.json();
          const data = createRecurringInvoiceTemplateSchema.parse(body);
          
          const template = await this.invoiceService.createRecurringTemplate(data, apiRequest.context);
          
          return createSuccessResponse(template, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update recurring template
   */
  updateRecurringTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'recurring');

          const id = await this.extractIdFromPath(apiRequest);
          
          // Validate request body
          const body = await req.json();
          const data = updateRecurringInvoiceTemplateSchema.parse(body);
          
          // TODO: Implement recurring template update
          return createSuccessResponse({ template_id: id, ...data });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete recurring template
   */
  deleteRecurringTemplate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'recurring');

          const id = await this.extractIdFromPath(apiRequest);
          
          // TODO: Implement recurring template deletion
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List invoice items
   */
  listItems() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const invoice = await this.invoiceService.getById(id, apiRequest.context, { include_items: true });
          
          if (!invoice) {
            throw new NotFoundError('Invoice not found');
          }
          
          return createSuccessResponse((invoice as any).invoice_items || []);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List invoice transactions
   */
  listTransactions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          
          const invoice = await this.invoiceService.getById(id, apiRequest.context, { include_transactions: true });
          
          if (!invoice) {
            throw new NotFoundError('Invoice not found');
          }
          
          return createSuccessResponse((invoice as any).transactions || []);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Duplicate invoice
   */
  duplicate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiRequest = await this.authenticate(req);
        
        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          // Check permissions
          await this.checkPermission(apiRequest, 'create');

          const id = await this.extractIdFromPath(apiRequest);
          
          const originalInvoice = await this.invoiceService.getById(id, apiRequest.context, { include_items: true });
          
          if (!originalInvoice) {
            throw new NotFoundError('Invoice not found');
          }
          
          // Create a new invoice based on the original
          const duplicateData = {
            client_id: originalInvoice.client_id,
            invoice_date: new Date().toISOString().split('T')[0],
            due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            subtotal: originalInvoice.subtotal,
            tax: originalInvoice.tax,
            total_amount: originalInvoice.total_amount,
            status: 'draft' as const,
            credit_applied: 0,
            is_manual: true,
            is_prepayment: false,
            items: (originalInvoice as any).invoice_items || []
          };
          
          const duplicatedInvoice = await this.invoiceService.create(duplicateData, apiRequest.context);
          
          return createSuccessResponse(duplicatedInvoice, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
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

  /**
   * Override extractIdFromPath for invoice routes
   */
  protected async extractIdFromPath(req: ApiRequest): Promise<string> {
    // Check if params were passed from Next.js dynamic route
    if ('params' in req && req.params) {
      const params = await req.params;
      if (params && 'id' in params) {
        const id = params.id;
        
        // Validate UUID format (including nil UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (id && !uuidRegex.test(id)) {
          throw new ValidationError('Invalid invoice ID format');
        }
        
        return id;
      }
    }
    
    // Fallback to extracting from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const invoicesIndex = pathParts.findIndex(part => part === 'invoices');
    const id = pathParts[invoicesIndex + 1] || '';
    
    // Validate UUID format (including nil UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (id && !uuidRegex.test(id)) {
      throw new ValidationError('Invalid invoice ID format');
    }
    
    return id;
  }
}
