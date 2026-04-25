import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerFinancialInvoiceRoutes(registry: ApiOpenApiRegistry) {
  const billingAnalyticsTag = 'Billing Analytics';
  const financialTag = 'Financial';
  const invoiceTag = 'Invoices';

  const UuidIdParam = registry.registerSchema(
    'FinancialInvoiceUuidIdParam',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Path UUID parameter resolved by ApiBaseController.extractIdFromPath().'),
    }),
  );

  const ApiError = registry.registerSchema(
    'FinancialInvoiceApiError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const ApiSuccess = registry.registerSchema(
    'FinancialInvoiceApiSuccess',
    zOpenApi.object({
      data: zOpenApi.union([
        zOpenApi.record(zOpenApi.unknown()),
        zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      ]),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const ApiPaginated = registry.registerSchema(
    'FinancialInvoiceApiPaginated',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
        hasNext: zOpenApi.boolean(),
        hasPrev: zOpenApi.boolean(),
      }),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const FinancialListQuery = registry.registerSchema(
    'FinancialListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      search: zOpenApi.string().optional(),
      created_from: zOpenApi.string().optional(),
      created_to: zOpenApi.string().optional(),
      updated_from: zOpenApi.string().optional(),
      updated_to: zOpenApi.string().optional(),
      client_id: zOpenApi.string().uuid().optional(),
      invoice_id: zOpenApi.string().uuid().optional(),
      type: zOpenApi.string().optional(),
      status: zOpenApi.string().optional(),
      amount_min: zOpenApi.string().optional(),
      amount_max: zOpenApi.string().optional(),
      include_expired: zOpenApi.enum(['true', 'false']).optional(),
      expiring_soon: zOpenApi.enum(['true', 'false']).optional(),
      has_remaining: zOpenApi.enum(['true', 'false']).optional(),
      has_expiration: zOpenApi.enum(['true', 'false']).optional(),
      date_from: zOpenApi.string().optional(),
      date_to: zOpenApi.string().optional(),
      group_by: zOpenApi.enum(['day', 'week', 'month']).optional(),
      include_projections: zOpenApi.enum(['true', 'false']).optional(),
      as_of_date: zOpenApi.string().optional(),
    }),
  );

  const InvoiceListQuery = registry.registerSchema(
    'InvoiceListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      include_items: zOpenApi.enum(['true', 'false']).optional(),
      include_client: zOpenApi.enum(['true', 'false']).optional(),
      include_billing_cycle: zOpenApi.enum(['true', 'false']).optional(),
      include_transactions: zOpenApi.enum(['true', 'false']).optional(),
      q: zOpenApi.string().optional(),
      from: zOpenApi.string().optional(),
      to: zOpenApi.string().optional(),
      format: zOpenApi.enum(['json', 'csv']).optional(),
    }).catchall(zOpenApi.string()),
  );

  const ExecutionIdQuery = registry.registerSchema(
    'InvoiceExecutionIdQuery',
    zOpenApi.object({
      execution_id: zOpenApi.string().optional(),
      reason: zOpenApi.string().optional(),
    }),
  );

  const BillingOverviewResponse = registry.registerSchema(
    'BillingOverviewResponse',
    zOpenApi.object({
      data: zOpenApi.record(zOpenApi.unknown()),
      count: zOpenApi.number().optional(),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const CalculateBillingBody = registry.registerSchema(
    'FinancialCalculateBillingBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      period_start: zOpenApi.string(),
      period_end: zOpenApi.string(),
    }),
  );

  const ApplyCreditToInvoiceBody = registry.registerSchema(
    'FinancialApplyCreditToInvoiceBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      invoice_id: zOpenApi.string().uuid(),
      requested_amount: zOpenApi.number().min(0),
    }),
  );

  const PrepaymentInvoiceBody = registry.registerSchema(
    'FinancialPrepaymentInvoiceBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      amount: zOpenApi.number().min(0),
      manual_expiration_date: zOpenApi.string().optional(),
    }),
  );

  const TransferCreditBody = registry.registerSchema(
    'FinancialTransferCreditBody',
    zOpenApi.object({
      source_credit_id: zOpenApi.string().uuid(),
      target_client_id: zOpenApi.string().uuid(),
      amount: zOpenApi.number().min(0),
      user_id: zOpenApi.string().uuid(),
      reason: zOpenApi.string().optional(),
    }),
  );

  const ValidateCreditBody = registry.registerSchema(
    'FinancialValidateCreditBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
    }),
  );

  const CreateTransactionBody = registry.registerSchema(
    'FinancialCreateTransactionBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      invoice_id: zOpenApi.string().uuid().optional(),
      amount: zOpenApi.number(),
      type: zOpenApi.string(),
      status: zOpenApi.string().optional(),
      parent_transaction_id: zOpenApi.string().uuid().optional(),
      description: zOpenApi.string().optional(),
      reference_number: zOpenApi.string().optional(),
      metadata: zOpenApi.record(zOpenApi.unknown()).optional(),
      balance_after: zOpenApi.number(),
      expiration_date: zOpenApi.string().optional(),
      related_transaction_id: zOpenApi.string().uuid().optional(),
    }),
  );

  const UpdateTransactionBody = registry.registerSchema('FinancialUpdateTransactionBody', CreateTransactionBody.partial());

  const CreatePaymentMethodBody = registry.registerSchema(
    'FinancialCreatePaymentMethodBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      type: zOpenApi.enum(['credit_card', 'bank_account']),
      last4: zOpenApi.string().length(4),
      exp_month: zOpenApi.string().optional(),
      exp_year: zOpenApi.string().optional(),
      is_default: zOpenApi.boolean().optional(),
      is_deleted: zOpenApi.boolean().optional(),
    }),
  );

  const CalculateTaxBody = registry.registerSchema(
    'FinancialCalculateTaxBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      amount: zOpenApi.number().min(0),
      tax_region: zOpenApi.string(),
      date: zOpenApi.string().optional(),
    }),
  );

  const BulkInvoiceOperationBody = registry.registerSchema(
    'FinancialBulkInvoiceOperationBody',
    zOpenApi.object({
      operation: zOpenApi.enum(['send', 'finalize', 'cancel', 'mark_paid']),
      invoice_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
      options: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const BulkTransactionOperationBody = registry.registerSchema(
    'FinancialBulkTransactionOperationBody',
    zOpenApi.object({
      operation: zOpenApi.enum(['approve', 'reject', 'void']),
      transaction_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
      options: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const BulkCreditOperationBody = registry.registerSchema(
    'FinancialBulkCreditOperationBody',
    zOpenApi.object({
      operation: zOpenApi.enum(['expire', 'extend', 'transfer']),
      credit_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
      options: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const ReconciliationResolveBody = registry.registerSchema(
    'FinancialReconciliationResolveBody',
    zOpenApi.object({ notes: zOpenApi.string().optional() }),
  );

  const InvoiceCreateBody = registry.registerSchema(
    'InvoiceCreateBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      invoice_date: zOpenApi.string(),
      due_date: zOpenApi.string(),
      subtotal: zOpenApi.number().int().min(0),
      tax: zOpenApi.number().int().min(0),
      total_amount: zOpenApi.number().int().min(0),
      status: zOpenApi.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled', 'pending', 'prepayment', 'partially_applied']),
      credit_applied: zOpenApi.number().int().min(0).optional(),
      is_manual: zOpenApi.boolean().optional(),
      is_prepayment: zOpenApi.boolean().optional(),
      items: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
    }).catchall(zOpenApi.unknown()),
  );

  const InvoiceUpdateBody = registry.registerSchema('InvoiceUpdateBody', InvoiceCreateBody.partial());

  const InvoiceManualBody = registry.registerSchema(
    'InvoiceManualBody',
    zOpenApi.object({
      clientId: zOpenApi.string().uuid(),
      items: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).min(1),
      expirationDate: zOpenApi.string().optional(),
      isPrepayment: zOpenApi.boolean().optional(),
    }),
  );

  const InvoiceSelectorBody = registry.registerSchema(
    'InvoiceSelectorBody',
    zOpenApi.object({
      selector_input: zOpenApi.object({
        clientId: zOpenApi.string().uuid(),
        windowStart: zOpenApi.string(),
        windowEnd: zOpenApi.string(),
        executionWindow: zOpenApi.object({
          kind: zOpenApi.enum(['client_cadence_window', 'contract_cadence_window']),
          identityKey: zOpenApi.string(),
          cadenceOwner: zOpenApi.enum(['client', 'contract']),
          clientId: zOpenApi.string().uuid().optional(),
          billingCycleId: zOpenApi.string().uuid().nullable().optional(),
          contractId: zOpenApi.string().uuid().nullable().optional(),
          contractLineId: zOpenApi.string().uuid().nullable().optional(),
          windowStart: zOpenApi.string().nullable().optional(),
          windowEnd: zOpenApi.string().nullable().optional(),
        }),
      }),
    }),
  );

  const InvoiceFinalizeBody = registry.registerSchema(
    'InvoiceFinalizeBody',
    zOpenApi.object({
      finalized_at: zOpenApi.string().optional(),
    }),
  );

  const InvoiceSendBody = registry.registerSchema(
    'InvoiceSendBody',
    zOpenApi.object({
      email_addresses: zOpenApi.array(zOpenApi.string().email()).min(1),
      subject: zOpenApi.string().optional(),
      message: zOpenApi.string().optional(),
      include_pdf: zOpenApi.boolean().optional(),
    }),
  );

  const InvoiceCreditBody = registry.registerSchema(
    'InvoiceCreditBody',
    zOpenApi.object({
      credit_amount: zOpenApi.number().int().min(0),
      transaction_id: zOpenApi.string().uuid().optional(),
    }),
  );

  const InvoicePaymentBody = registry.registerSchema(
    'InvoicePaymentBody',
    zOpenApi.object({
      payment_amount: zOpenApi.number().int().min(0),
      payment_method: zOpenApi.string(),
      payment_date: zOpenApi.string().optional(),
      reference_number: zOpenApi.string().optional(),
      notes: zOpenApi.string().optional(),
    }),
  );

  const InvoiceTaxBody = registry.registerSchema(
    'InvoiceTaxBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      amount: zOpenApi.number().int().min(0),
      tax_region: zOpenApi.string(),
      calculation_date: zOpenApi.string().optional(),
    }),
  );

  const InvoiceBulkStatusBody = registry.registerSchema(
    'InvoiceBulkStatusBody',
    zOpenApi.object({
      invoice_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(100),
      status: zOpenApi.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled', 'pending', 'prepayment', 'partially_applied']),
      finalized_at: zOpenApi.string().optional(),
    }),
  );

  const InvoiceBulkSendBody = registry.registerSchema(
    'InvoiceBulkSendBody',
    zOpenApi.object({
      invoice_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(50),
      email_template: zOpenApi.string().optional(),
      include_pdf: zOpenApi.boolean().optional(),
    }),
  );

  const InvoiceBulkDeleteBody = registry.registerSchema(
    'InvoiceBulkDeleteBody',
    zOpenApi.object({
      ids: zOpenApi.array(zOpenApi.string().uuid()).min(1),
      force: zOpenApi.boolean().optional(),
    }),
  );

  const InvoiceBulkCreditBody = registry.registerSchema(
    'InvoiceBulkCreditBody',
    zOpenApi.object({
      invoice_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(100),
      credit_amount_per_invoice: zOpenApi.number().int().min(0),
    }),
  );

  const InvoiceRecurringCreateBody = registry.registerSchema(
    'InvoiceRecurringCreateBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      name: zOpenApi.string(),
      frequency: zOpenApi.enum(['daily', 'weekly', 'monthly', 'quarterly', 'annually']),
      start_date: zOpenApi.string(),
      end_date: zOpenApi.string().optional(),
      is_active: zOpenApi.boolean().optional(),
      invoice_template: zOpenApi.record(zOpenApi.unknown()),
      max_generations: zOpenApi.number().optional(),
    }),
  );

  const commonExtensions = {
    'x-tenant-scoped': true,
    'x-auth-mechanism': 'x-api-key header validated in ApiBaseController.authenticate()',
    'x-tenant-header': 'x-tenant-id (optional; otherwise tenant inferred from key)',
  };

  const contextGapExtensions = {
    'x-tenant-scoped': true,
    'x-auth-source': 'middleware API-key presence check only',
    'x-request-context-required': true,
    'x-request-context-wiring-gap': true,
  };

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/billing-analytics/overview',
    summary: 'Get billing overview analytics',
    description:
      'Maps to ApiContractLineController.getBillingOverviewAnalytics(). The method requires request context via requireRequestContext(req), but this route does not authenticate/set req.context in the handler. Current behavior can fail with 500 "Request context not available" when middleware has not injected context.',
    tags: [billingAnalyticsTag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Billing analytics payload returned.', schema: BillingOverviewResponse },
      500: { description: 'Request context missing or other server failure.', schema: ApiError },
    },
    extensions: contextGapExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/financial/billing/calculate',
    summary: 'Calculate client billing charges',
    description: 'Calculates billing for one client and billing window using FinancialService.calculateBilling(). Requires financial:read permission.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CalculateBillingBody } },
    responses: {
      200: { description: 'Billing calculation returned.', schema: ApiSuccess },
      400: { description: 'Invalid billing calculation payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected billing calculation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/financial/billing/payment-terms',
    summary: 'List billing payment terms',
    description: 'Returns payment terms from FinancialService.getPaymentTerms().',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Payment terms returned.', schema: ApiSuccess },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected payment terms failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  const financialBulkRoutes: Array<[string, string, string, any, Record<string, unknown>]> = [
    ['/api/v1/financial/bulk/invoices', 'Run bulk invoice operation', 'FinancialService.bulkInvoiceOperation() supports send/finalize/cancel/mark_paid operations.', BulkInvoiceOperationBody, {}],
    ['/api/v1/financial/bulk/transactions', 'Run bulk transaction operation', 'Route validates payload but currently returns 501 Not implemented (TODO in ApiFinancialController.bulkTransactionOperations).', BulkTransactionOperationBody, { 'x-implementation-gap': 'Not implemented; returns 501.' }],
    ['/api/v1/financial/bulk/credits', 'Run bulk credit operation', 'Route validates payload but currently returns 501 Not implemented (TODO in ApiFinancialController.bulkCreditOperations).', BulkCreditOperationBody, { 'x-implementation-gap': 'Not implemented; returns 501.' }],
  ];

  for (const [path, summary, description, schema, extraExtensions] of financialBulkRoutes) {
    registry.registerRoute({
      method: 'post',
      path,
      summary,
      description,
      tags: [financialTag],
      security: [{ ApiKeyAuth: [] }],
      request: { body: { schema } },
      responses: {
        200: { description: 'Bulk operation processed.', schema: ApiSuccess },
        400: { description: 'Invalid bulk operation payload.', schema: ApiError },
        401: { description: 'API key missing/invalid.', schema: ApiError },
        403: { description: 'financial:update permission denied.', schema: ApiError },
        501: { description: 'Endpoint intentionally returns Not implemented.', schema: ApiError },
        500: { description: 'Unexpected bulk operation failure.', schema: ApiError },
      },
      extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'update', ...extraExtensions },
      edition: 'both',
    });
  }

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/financial/credits',
    summary: 'List credit balances and records',
    description: 'Lists credits with filters using FinancialService.listClientCredits().',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: FinancialListQuery },
    responses: {
      200: { description: 'Paginated credit records returned.', schema: ApiPaginated },
      400: { description: 'Invalid credit query parameters.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected credit listing failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  const financialCreditMutationRoutes: Array<[string, string, string, any, string, Record<string, unknown>?]> = [
    ['/api/v1/financial/credits/apply', 'Apply credit to invoice', 'Applies client credit to an invoice via FinancialService.applyCreditToInvoice().', ApplyCreditToInvoiceBody, 'update'],
    ['/api/v1/financial/credits/prepayment', 'Create prepayment invoice', 'Creates a prepayment invoice and corresponding credit allocation.', PrepaymentInvoiceBody, 'create'],
    ['/api/v1/financial/credits/transfer', 'Transfer credit between clients', 'Transfers credit between clients via FinancialService.transferCredit().', TransferCreditBody, 'transfer'],
    ['/api/v1/financial/credits/validate', 'Validate client credit balance', 'Validates whether a client has sufficient usable credit.', ValidateCreditBody, 'read'],
  ];

  for (const [path, summary, description, schema, action] of financialCreditMutationRoutes) {
    registry.registerRoute({
      method: 'post',
      path,
      summary,
      description,
      tags: [financialTag],
      security: [{ ApiKeyAuth: [] }],
      request: { body: { schema } },
      responses: {
        200: { description: 'Credit operation completed.', schema: ApiSuccess },
        201: { description: 'Credit operation created a new record.', schema: ApiSuccess },
        400: { description: 'Invalid request payload.', schema: ApiError },
        401: { description: 'API key missing/invalid.', schema: ApiError },
        403: { description: `financial:${action} permission denied.`, schema: ApiError },
        500: { description: 'Unexpected credit operation failure.', schema: ApiError },
      },
      extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': action },
      edition: 'both',
    });
  }

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/financial/invoices',
    summary: 'List financial invoices (transaction list wiring)',
    description:
      'Route file maps to ApiFinancialController.list(), which is transaction-oriented (resource financial/transactions) rather than invoice-specific list logic. Current response is the generic transaction list envelope with financial report links.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: FinancialListQuery },
    responses: {
      200: { description: 'Paginated financial list returned.', schema: ApiPaginated },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected listing failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'financial',
      'x-rbac-action': 'read',
      'x-route-to-controller-mismatch': true,
      'x-controller-method': 'ApiFinancialController.list()',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/financial/invoices/{id}/finalize',
    summary: 'Finalize financial invoice (maps to generic update)',
    description:
      'Despite route naming, the handler calls ApiFinancialController.update() which performs generic financial update validation and update semantics. Path id is extracted as financial resource id and processed by FinancialService.update().',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: UuidIdParam,
      body: { schema: UpdateTransactionBody },
    },
    responses: {
      200: { description: 'Financial resource updated.', schema: ApiSuccess },
      400: { description: 'Invalid id or payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:update permission denied.', schema: ApiError },
      404: { description: 'Financial resource not found.', schema: ApiError },
      500: { description: 'Unexpected update failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'financial',
      'x-rbac-action': 'update',
      'x-route-to-controller-mismatch': true,
      'x-controller-method': 'ApiFinancialController.update()',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/financial/invoices/{id}/items',
    summary: 'Add financial invoice item (maps to generic create)',
    description:
      'Route maps to ApiFinancialController.create(), which validates createTransactionSchema and creates a financial transaction. The path {id} is not consumed by create().',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: UuidIdParam,
      body: { schema: CreateTransactionBody },
    },
    responses: {
      201: { description: 'Financial transaction created.', schema: ApiSuccess },
      400: { description: 'Invalid request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:create permission denied.', schema: ApiError },
      500: { description: 'Unexpected create failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'financial',
      'x-rbac-action': 'create',
      'x-route-to-controller-mismatch': true,
      'x-controller-method': 'ApiFinancialController.create()',
      'x-path-param-currently-unused': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/financial/payment-methods',
    summary: 'List payment methods (transaction list wiring)',
    description:
      'Current route wiring calls ApiFinancialController.list(), which lists transaction records and not payment methods. This discrepancy is documented as implementation behavior.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: FinancialListQuery },
    responses: {
      200: { description: 'Paginated list returned.', schema: ApiPaginated },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected list failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'financial',
      'x-rbac-action': 'read',
      'x-route-to-controller-mismatch': true,
      'x-controller-method': 'ApiFinancialController.list()',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/financial/payment-methods',
    summary: 'Create payment method',
    description: 'Creates a payment method using FinancialService.createPaymentMethod().',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CreatePaymentMethodBody } },
    responses: {
      201: { description: 'Payment method created.', schema: ApiSuccess },
      400: { description: 'Invalid request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:create permission denied.', schema: ApiError },
      500: { description: 'Unexpected payment method creation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'create' },
    edition: 'both',
  });

  const financialPaymentMethodIdRoutes: Array<[string, string, string, string, any?]> = [
    ['get', '/api/v1/financial/payment-methods/{id}', 'Get payment method by id (transaction get wiring)', 'Route maps to ApiFinancialController.getById(), which fetches a financial transaction by id.', undefined],
    ['put', '/api/v1/financial/payment-methods/{id}', 'Update payment method by id (transaction update wiring)', 'Route maps to ApiFinancialController.update(), which updates generic financial resource fields.', UpdateTransactionBody],
    ['delete', '/api/v1/financial/payment-methods/{id}', 'Delete payment method by id (transaction delete wiring)', 'Route maps to ApiFinancialController.delete(), deleting a generic financial resource by id.', undefined],
  ];

  for (const [method, path, summary, description, bodySchema] of financialPaymentMethodIdRoutes) {
    registry.registerRoute({
      method: method as 'get' | 'put' | 'delete',
      path,
      summary,
      description,
      tags: [financialTag],
      security: [{ ApiKeyAuth: [] }],
      request: {
        params: UuidIdParam,
        ...(bodySchema ? { body: { schema: bodySchema } } : {}),
      },
      responses: {
        200: { description: 'Operation succeeded.', schema: ApiSuccess },
        204: { description: 'Resource deleted.', emptyBody: true },
        400: { description: 'Invalid id or request payload.', schema: ApiError },
        401: { description: 'API key missing/invalid.', schema: ApiError },
        403: { description: `financial:${method === 'delete' ? 'delete' : method === 'put' ? 'update' : 'read'} permission denied.`, schema: ApiError },
        404: { description: 'Resource not found.', schema: ApiError },
        500: { description: 'Unexpected operation failure.', schema: ApiError },
      },
      extensions: {
        ...commonExtensions,
        'x-rbac-resource': 'financial',
        'x-rbac-action': method === 'delete' ? 'delete' : method === 'put' ? 'update' : 'read',
        'x-route-to-controller-mismatch': true,
      },
      edition: 'both',
    });
  }

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/financial/reconciliation/run',
    summary: 'Run financial reconciliation',
    description: 'Triggers FinancialService.runCreditReconciliation(). Optional client_id query narrows reconciliation target.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: FinancialListQuery },
    responses: {
      200: { description: 'Reconciliation run completed.', schema: ApiSuccess },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:update permission denied.', schema: ApiError },
      500: { description: 'Unexpected reconciliation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/financial/reconciliation/{id}/resolve',
    summary: 'Resolve reconciliation report',
    description: 'Resolves one reconciliation report by id with optional operator notes.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam, body: { schema: ReconciliationResolveBody } },
    responses: {
      200: { description: 'Reconciliation report resolved.', schema: ApiSuccess },
      400: { description: 'Invalid id or payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:update permission denied.', schema: ApiError },
      404: { description: 'Reconciliation report not found.', schema: ApiError },
      500: { description: 'Unexpected resolution failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  const financialReportRoutes: Array<[string, string, string]> = [
    ['/api/v1/financial/reports/aging', 'Get aging report', 'Returns aging buckets and summary for tenant-wide receivables or one client.'],
    ['/api/v1/financial/reports/analytics', 'Get financial analytics', 'Returns aggregate financial analytics for a date range.'],
    ['/api/v1/financial/reports/balance', 'Get account balance report', 'Returns balance summary for one client_id (required by controller).'],
  ];

  for (const [path, summary, description] of financialReportRoutes) {
    registry.registerRoute({
      method: 'get',
      path,
      summary,
      description,
      tags: [financialTag],
      security: [{ ApiKeyAuth: [] }],
      request: { query: FinancialListQuery },
      responses: {
        200: { description: 'Report returned.', schema: ApiSuccess },
        400: { description: 'Invalid report query parameters.', schema: ApiError },
        401: { description: 'API key missing/invalid.', schema: ApiError },
        403: { description: 'financial:read permission denied.', schema: ApiError },
        500: { description: 'Unexpected report failure.', schema: ApiError },
      },
      extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'read' },
      edition: 'both',
    });
  }

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/financial/tax/calculate',
    summary: 'Calculate financial tax',
    description: 'Calculates tax for a client/amount/tax_region tuple. Requires financial:read permission in current controller implementation.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CalculateTaxBody } },
    responses: {
      200: { description: 'Tax calculation returned.', schema: ApiSuccess },
      400: { description: 'Invalid tax request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected tax calculation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/financial/tax/rates',
    summary: 'List financial tax rates (transaction list wiring)',
    description:
      'Route file currently maps to ApiFinancialController.list(), so the response is the generic financial transaction list rather than a tax-rate list.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: FinancialListQuery },
    responses: {
      200: { description: 'Paginated list returned.', schema: ApiPaginated },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected list failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'financial',
      'x-rbac-action': 'read',
      'x-route-to-controller-mismatch': true,
      'x-controller-method': 'ApiFinancialController.list()',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/financial/transactions',
    summary: 'List financial transactions',
    description: 'Lists transactions with advanced filtering.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: FinancialListQuery },
    responses: {
      200: { description: 'Paginated transactions returned.', schema: ApiPaginated },
      400: { description: 'Invalid transaction query parameters.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected transaction listing failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/financial/transactions',
    summary: 'Create financial transaction',
    description: 'Creates one financial transaction.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CreateTransactionBody } },
    responses: {
      201: { description: 'Transaction created.', schema: ApiSuccess },
      400: { description: 'Invalid transaction payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:create permission denied.', schema: ApiError },
      500: { description: 'Unexpected transaction creation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'create' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/financial/transactions/{id}',
    summary: 'Get financial transaction by id',
    description: 'Loads one financial transaction by id.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam },
    responses: {
      200: { description: 'Transaction returned.', schema: ApiSuccess },
      400: { description: 'Invalid transaction id format.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:read permission denied.', schema: ApiError },
      404: { description: 'Transaction not found.', schema: ApiError },
      500: { description: 'Unexpected transaction retrieval failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/financial/transactions/{id}',
    summary: 'Update financial transaction',
    description: 'Updates one transaction id with partial payload.',
    tags: [financialTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam, body: { schema: UpdateTransactionBody } },
    responses: {
      200: { description: 'Transaction updated.', schema: ApiSuccess },
      400: { description: 'Invalid transaction id or payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'financial:update permission denied.', schema: ApiError },
      404: { description: 'Transaction not found.', schema: ApiError },
      500: { description: 'Unexpected transaction update failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'financial', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/invoices',
    summary: 'List invoices',
    description: 'Lists invoices with pagination, filter query keys, and include flags.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: InvoiceListQuery },
    responses: {
      200: { description: 'Paginated invoices returned.', schema: ApiPaginated },
      400: { description: 'Invalid list query parameters.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected invoice list failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices',
    summary: 'Create invoice',
    description: 'Creates an invoice record via ApiBaseController.create() and invoice create schema.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceCreateBody } },
    responses: {
      201: { description: 'Invoice created.', schema: ApiSuccess },
      400: { description: 'Invalid invoice payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:create permission denied.', schema: ApiError },
      500: { description: 'Unexpected invoice creation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'create' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/invoices/analytics',
    summary: 'Get invoice analytics',
    description: 'Returns aggregate analytics for invoice states and amounts over optional from/to range.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: InvoiceListQuery },
    responses: {
      200: { description: 'Invoice analytics returned.', schema: ApiSuccess },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:analytics permission denied.', schema: ApiError },
      500: { description: 'Unexpected analytics failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'analytics' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/bulk',
    summary: 'Bulk update invoice status',
    description: 'Bulk status transition route using bulkInvoiceStatusUpdateSchema.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceBulkStatusBody } },
    responses: {
      200: { description: 'Bulk status update completed.', schema: ApiSuccess },
      400: { description: 'Invalid bulk status payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:bulk_update permission denied.', schema: ApiError },
      500: { description: 'Unexpected bulk status failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'bulk_update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/bulk/credit',
    summary: 'Bulk apply invoice credits',
    description: 'Applies the same credit amount to each listed invoice; response includes successes and per-invoice errors.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceBulkCreditBody } },
    responses: {
      200: { description: 'Bulk credit operation completed.', schema: ApiSuccess },
      400: { description: 'Invalid bulk credit payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:bulk_credit permission denied.', schema: ApiError },
      500: { description: 'Unexpected bulk credit failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'bulk_credit' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/bulk/delete',
    summary: 'Bulk delete invoices',
    description: 'Deletes multiple invoice records in one request.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceBulkDeleteBody } },
    responses: {
      200: { description: 'Bulk delete completed.', schema: ApiSuccess },
      400: { description: 'Invalid bulk delete payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:bulk_delete permission denied.', schema: ApiError },
      500: { description: 'Unexpected bulk delete failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'bulk_delete' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/bulk/send',
    summary: 'Bulk send invoices',
    description: 'Enqueues or executes invoice send for multiple invoice IDs.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceBulkSendBody } },
    responses: {
      200: { description: 'Bulk send completed.', schema: ApiSuccess },
      400: { description: 'Invalid bulk send payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:bulk_send permission denied.', schema: ApiError },
      500: { description: 'Unexpected bulk send failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'bulk_send' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/invoices/export',
    summary: 'Export invoices',
    description: 'Exports invoice data. format=csv returns text/csv attachment; default is JSON success envelope.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: InvoiceListQuery },
    responses: {
      200: { description: 'Invoice export returned.', schema: ApiSuccess },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected export failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'invoice',
      'x-rbac-action': 'read',
      'x-alt-response-content-type': 'text/csv',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/generate',
    summary: 'Generate recurring invoice',
    description: 'Generates one recurring invoice using canonical selector_input payload.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceSelectorBody } },
    responses: {
      201: { description: 'Invoice generated.', schema: ApiSuccess },
      400: { description: 'Invalid selector payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:create permission denied.', schema: ApiError },
      500: { description: 'Unexpected generation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'create' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/manual',
    summary: 'Create manual invoice',
    description: 'Creates a manual invoice using clientId + items payload.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceManualBody } },
    responses: {
      201: { description: 'Manual invoice created.', schema: ApiSuccess },
      400: { description: 'Invalid manual invoice payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:create permission denied.', schema: ApiError },
      500: { description: 'Unexpected manual invoice failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'create' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/preview',
    summary: 'Preview recurring invoice',
    description: 'Previews invoice output for selector_input payload without committing final invoice state.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceSelectorBody } },
    responses: {
      200: { description: 'Invoice preview returned.', schema: ApiSuccess },
      400: { description: 'Invalid selector payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected preview failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/invoices/recurring',
    summary: 'List recurring invoice templates',
    description: 'Current implementation returns an empty list placeholder (TODO in ApiInvoiceController.listRecurringTemplates).',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Recurring template list returned (currently empty).', schema: ApiSuccess },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:recurring permission denied.', schema: ApiError },
      500: { description: 'Unexpected recurring template list failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'invoice',
      'x-rbac-action': 'recurring',
      'x-implementation-gap': 'Returns [] placeholder.',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/recurring',
    summary: 'Create recurring invoice template',
    description: 'Creates a recurring template used for scheduled invoice generation.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: InvoiceRecurringCreateBody } },
    responses: {
      201: { description: 'Recurring template created.', schema: ApiSuccess },
      400: { description: 'Invalid recurring template payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:recurring permission denied.', schema: ApiError },
      500: { description: 'Unexpected recurring template creation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'recurring' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/invoices/recurring/{id}',
    summary: 'Update recurring invoice template',
    description: 'Current implementation echoes payload and id without persistence (TODO in ApiInvoiceController.updateRecurringTemplate).',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam, body: { schema: InvoiceRecurringCreateBody.partial() } },
    responses: {
      200: { description: 'Recurring template update response returned.', schema: ApiSuccess },
      400: { description: 'Invalid id or payload.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:recurring permission denied.', schema: ApiError },
      500: { description: 'Unexpected recurring template update failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'invoice',
      'x-rbac-action': 'recurring',
      'x-implementation-gap': 'Update is TODO; response is synthetic.',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/invoices/recurring/{id}',
    summary: 'Delete recurring invoice template',
    description: 'Current implementation is TODO and returns 204 without delete persistence.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam },
    responses: {
      204: { description: 'Recurring template deleted (current TODO stub response).', emptyBody: true },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:recurring permission denied.', schema: ApiError },
      500: { description: 'Unexpected recurring template delete failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'invoice',
      'x-rbac-action': 'recurring',
      'x-implementation-gap': 'Delete is TODO; returns 204 directly.',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/invoices/search',
    summary: 'Search invoices',
    description: 'Searches invoices by free-text q with paginated response.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: InvoiceListQuery },
    responses: {
      200: { description: 'Search results returned.', schema: ApiPaginated },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:read permission denied.', schema: ApiError },
      500: { description: 'Unexpected search failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  const invoiceByIdBaseRoutes: Array<[string, string, string, string, any?, number?]> = [
    ['get', '/api/v1/invoices/{id}', 'Get invoice by id', 'Returns one invoice with optional include flags.', undefined, 200],
    ['put', '/api/v1/invoices/{id}', 'Update invoice', 'Updates an invoice using ApiBaseController.update().', InvoiceUpdateBody, 200],
    ['delete', '/api/v1/invoices/{id}', 'Delete invoice', 'Deletes one invoice using ApiBaseController.delete().', undefined, 204],
  ];

  for (const [method, path, summary, description, bodySchema, successStatus] of invoiceByIdBaseRoutes) {
    registry.registerRoute({
      method: method as 'get' | 'put' | 'delete',
      path,
      summary,
      description,
      tags: [invoiceTag],
      security: [{ ApiKeyAuth: [] }],
      request: {
        params: UuidIdParam,
        ...(method === 'get' ? { query: InvoiceListQuery } : {}),
        ...(bodySchema ? { body: { schema: bodySchema } } : {}),
      },
      responses: {
        [successStatus || 200]: successStatus === 204 ? { description: 'Invoice deleted.', emptyBody: true } : { description: 'Invoice operation succeeded.', schema: ApiSuccess },
        400: { description: 'Invalid id or payload.', schema: ApiError },
        401: { description: 'API key missing/invalid.', schema: ApiError },
        403: { description: `invoice:${method === 'get' ? 'read' : method === 'put' ? 'update' : 'delete'} permission denied.`, schema: ApiError },
        404: { description: 'Invoice not found.', schema: ApiError },
        500: { description: 'Unexpected invoice operation failure.', schema: ApiError },
      },
      extensions: {
        ...commonExtensions,
        'x-rbac-resource': 'invoice',
        'x-rbac-action': method === 'get' ? 'read' : method === 'put' ? 'update' : 'delete',
      },
      edition: 'both',
    });
  }

  const invoiceActionRoutes: Array<[string, string, string, string, any?, any?, string]> = [
    ['post', '/api/v1/invoices/{id}/approve', 'Approve invoice', 'Approves one invoice; optional execution_id query is forwarded to workflow context.', undefined, ExecutionIdQuery, 'approve'],
    ['post', '/api/v1/invoices/{id}/credit', 'Apply credit to invoice', 'Applies credit amount to one invoice.', InvoiceCreditBody, undefined, 'credit'],
    ['post', '/api/v1/invoices/{id}/duplicate', 'Duplicate invoice', 'Clones an invoice into a new draft/manual invoice.', undefined, undefined, 'create'],
    ['post', '/api/v1/invoices/{id}/finalize', 'Finalize invoice', 'Finalizes one invoice. invoice_id is path-derived and merged into finalize schema.', InvoiceFinalizeBody, undefined, 'finalize'],
    ['post', '/api/v1/invoices/{id}/payment', 'Record invoice payment', 'Records payment for one invoice.', InvoicePaymentBody, undefined, 'payment'],
    ['post', '/api/v1/invoices/{id}/reject', 'Reject invoice', 'Rejects one invoice. Optional reason/execution_id come from query string.', undefined, ExecutionIdQuery, 'reject'],
    ['post', '/api/v1/invoices/{id}/send', 'Send invoice', 'Sends one invoice to provided recipient addresses.', InvoiceSendBody, undefined, 'send'],
    ['post', '/api/v1/invoices/{id}/tax', 'Calculate invoice tax', 'Calculates tax for invoice context; uses billing permission gate.', InvoiceTaxBody, undefined, 'billing'],
  ];

  for (const [method, path, summary, description, bodySchema, querySchema, action] of invoiceActionRoutes) {
    registry.registerRoute({
      method: method as 'post',
      path,
      summary,
      description,
      tags: [invoiceTag],
      security: [{ ApiKeyAuth: [] }],
      request: {
        params: UuidIdParam,
        ...(bodySchema ? { body: { schema: bodySchema } } : {}),
        ...(querySchema ? { query: querySchema } : {}),
      },
      responses: {
        200: { description: 'Invoice action succeeded.', schema: ApiSuccess },
        201: { description: 'Invoice action created a new invoice resource.', schema: ApiSuccess },
        400: { description: 'Invalid request payload or query.', schema: ApiError },
        401: { description: 'API key missing/invalid.', schema: ApiError },
        403: { description: `invoice:${action} permission denied.`, schema: ApiError },
        404: { description: 'Invoice not found.', schema: ApiError },
        500: { description: 'Unexpected invoice action failure.', schema: ApiError },
      },
      extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': action },
      edition: 'both',
    });
  }

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/invoices/{id}/items',
    summary: 'List invoice items',
    description: 'Returns invoice_charges array for one invoice id.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam },
    responses: {
      200: { description: 'Invoice item list returned.', schema: ApiSuccess },
      400: { description: 'Invalid invoice id.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:read permission denied.', schema: ApiError },
      404: { description: 'Invoice not found.', schema: ApiError },
      500: { description: 'Unexpected list-items failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/invoices/{id}/transactions',
    summary: 'List invoice transactions',
    description: 'Returns transactions array for one invoice id.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam },
    responses: {
      200: { description: 'Invoice transactions returned.', schema: ApiSuccess },
      400: { description: 'Invalid invoice id.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:read permission denied.', schema: ApiError },
      404: { description: 'Invoice not found.', schema: ApiError },
      500: { description: 'Unexpected list-transactions failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/invoices/{id}/pdf',
    summary: 'Generate invoice PDF asset',
    description: 'Generates/refreshes invoice PDF metadata and returns file_id plus optional download_url.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam },
    responses: {
      200: { description: 'PDF generation metadata returned.', schema: ApiSuccess },
      400: { description: 'Invalid invoice id.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:pdf permission denied.', schema: ApiError },
      404: { description: 'Invoice not found.', schema: ApiError },
      500: { description: 'Unexpected PDF generation failure.', schema: ApiError },
    },
    extensions: { ...commonExtensions, 'x-rbac-resource': 'invoice', 'x-rbac-action': 'pdf' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/invoices/{id}/pdf',
    summary: 'Redirect to invoice PDF download',
    description: 'Attempts to generate/load PDF metadata and redirects to download_url when present.',
    tags: [invoiceTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: UuidIdParam },
    responses: {
      307: { description: 'Redirect to generated PDF URL.', emptyBody: true },
      400: { description: 'Invalid invoice id.', schema: ApiError },
      401: { description: 'API key missing/invalid.', schema: ApiError },
      403: { description: 'invoice:pdf permission denied.', schema: ApiError },
      404: { description: 'PDF URL unavailable or invoice not found.', schema: ApiError },
      500: { description: 'Unexpected PDF download failure.', schema: ApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-rbac-resource': 'invoice',
      'x-rbac-action': 'pdf',
      'x-redirect-response': true,
    },
    edition: 'both',
  });
}
