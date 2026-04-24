import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerQuickBooksV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'QuickBooks v1';

  const MappingIdParam = registry.registerSchema(
    'QuickBooksV1MappingIdParam',
    zOpenApi.object({
      mapping_id: zOpenApi.string().describe('Mapping identifier extracted from path segment mapping_id.'),
    }),
  );

  const SyncIdParam = registry.registerSchema(
    'QuickBooksV1SyncIdParam',
    zOpenApi.object({
      sync_id: zOpenApi.string().describe('Sync operation identifier extracted from path segment sync_id.'),
    }),
  );

  const QboEntityQuery = registry.registerSchema(
    'QuickBooksV1EntityQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      active: zOpenApi.enum(['true', 'false']).optional(),
      search: zOpenApi.string().optional(),
      entity_type: zOpenApi.string().optional(),
      force_refresh: zOpenApi.enum(['true', 'false']).optional(),
    }),
  );

  const SyncHistoryQuery = registry.registerSchema(
    'QuickBooksV1SyncHistoryQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      status: zOpenApi.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'partial']).optional(),
      operation_type: zOpenApi
        .enum(['customer_sync', 'invoice_export', 'invoice_import', 'payment_sync', 'item_sync', 'tax_sync', 'full_sync', 'test_connection'])
        .optional(),
      date_from: zOpenApi.string().optional(),
      date_to: zOpenApi.string().optional(),
    }),
  );

  const OAuthInitiateBody = registry.registerSchema(
    'QuickBooksV1OAuthInitiateBody',
    zOpenApi.object({
      state: zOpenApi.string().min(1),
      redirect_uri: zOpenApi.string().url().optional(),
      scope: zOpenApi.string().optional(),
    }),
  );

  const OAuthCallbackBody = registry.registerSchema(
    'QuickBooksV1OAuthCallbackBody',
    zOpenApi.object({
      code: zOpenApi.string().min(1),
      state: zOpenApi.string().min(1),
      realmId: zOpenApi.string().min(1),
      error: zOpenApi.string().optional(),
      error_description: zOpenApi.string().optional(),
    }),
  );

  const ConnectionTestBody = registry.registerSchema(
    'QuickBooksV1ConnectionTestBody',
    zOpenApi.object({
      testType: zOpenApi.enum(['clientInfo', 'items', 'customers', 'full']).optional(),
      forceRefresh: zOpenApi.boolean().optional(),
    }),
  );

  const CustomerSyncBody = registry.registerSchema(
    'QuickBooksV1CustomerSyncBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().optional(),
      sync_type: zOpenApi.enum(['create', 'update', 'bidirectional']).optional(),
      force_update: zOpenApi.boolean().optional(),
      include_inactive: zOpenApi.boolean().optional(),
    }),
  );

  const InvoiceExportBody = registry.registerSchema(
    'QuickBooksV1InvoiceExportBody',
    zOpenApi.object({
      invoice_id: zOpenApi.string().uuid().optional(),
      date_range: zOpenApi
        .object({ start_date: zOpenApi.string(), end_date: zOpenApi.string() })
        .optional(),
      status_filter: zOpenApi
        .array(zOpenApi.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']))
        .optional(),
      client_id: zOpenApi.string().uuid().optional(),
      export_format: zOpenApi.enum(['qbo', 'json']).optional(),
      include_line_items: zOpenApi.boolean().optional(),
      auto_create_items: zOpenApi.boolean().optional(),
      skip_existing: zOpenApi.boolean().optional(),
    }),
  );

  const InvoiceImportBody = registry.registerSchema(
    'QuickBooksV1InvoiceImportBody',
    zOpenApi.object({
      qbo_invoice_id: zOpenApi.string().optional(),
      date_range: zOpenApi
        .object({ start_date: zOpenApi.string(), end_date: zOpenApi.string() })
        .optional(),
      import_payments: zOpenApi.boolean().optional(),
      auto_create_clients: zOpenApi.boolean().optional(),
      update_existing: zOpenApi.boolean().optional(),
    }),
  );

  const PaymentSyncBody = registry.registerSchema(
    'QuickBooksV1PaymentSyncBody',
    zOpenApi.object({
      payment_id: zOpenApi.string().uuid().optional(),
      invoice_id: zOpenApi.string().uuid().optional(),
      date_range: zOpenApi
        .object({ start_date: zOpenApi.string(), end_date: zOpenApi.string() })
        .optional(),
      sync_type: zOpenApi.enum(['create', 'update', 'bidirectional']).optional(),
      include_unapplied: zOpenApi.boolean().optional(),
    }),
  );

  const AccountMappingsBody = registry.registerSchema(
    'QuickBooksV1AccountMappingsBody',
    zOpenApi.object({
      mappings: zOpenApi
        .array(
          zOpenApi.object({
            account_type: zOpenApi.enum(['income', 'expense', 'asset', 'liability', 'equity']),
            alga_account_name: zOpenApi.string(),
            qbo_account_id: zOpenApi.string(),
            is_default: zOpenApi.boolean().optional(),
          }),
        )
        .min(1),
      replace_existing: zOpenApi.boolean().optional(),
    }),
  );

  const TaxMappingsBody = registry.registerSchema(
    'QuickBooksV1TaxMappingsBody',
    zOpenApi.object({
      mappings: zOpenApi
        .array(
          zOpenApi.object({
            alga_tax_region: zOpenApi.string(),
            qbo_tax_code_id: zOpenApi.string(),
            is_default: zOpenApi.boolean().optional(),
          }),
        )
        .min(1),
      replace_existing: zOpenApi.boolean().optional(),
    }),
  );

  const DataMappingBody = registry.registerSchema(
    'QuickBooksV1DataMappingBody',
    zOpenApi.object({
      entity_type: zOpenApi.enum(['customer', 'invoice', 'payment', 'item', 'tax_code']),
      mapping_name: zOpenApi.string(),
      field_mappings: zOpenApi
        .array(
          zOpenApi.object({
            alga_field: zOpenApi.string(),
            qbo_field: zOpenApi.string(),
            transform_function: zOpenApi.string().optional(),
            is_required: zOpenApi.boolean().optional(),
            default_value: zOpenApi.unknown().optional(),
            validation_rule: zOpenApi.string().optional(),
          }),
        )
        .min(1),
      is_default: zOpenApi.boolean().optional(),
      description: zOpenApi.string().optional(),
    }),
  );

  const BulkSyncBody = registry.registerSchema(
    'QuickBooksV1BulkSyncBody',
    zOpenApi.object({
      operations: zOpenApi
        .array(
          zOpenApi.object({
            operation_type: zOpenApi
              .enum(['customer_sync', 'invoice_export', 'invoice_import', 'payment_sync', 'item_sync', 'tax_sync', 'full_sync', 'test_connection']),
            entity_ids: zOpenApi.array(zOpenApi.string().uuid()).optional(),
            qbo_entity_ids: zOpenApi.array(zOpenApi.string()).optional(),
            date_range: zOpenApi
              .object({ start_date: zOpenApi.string(), end_date: zOpenApi.string() })
              .optional(),
            parameters: zOpenApi.record(zOpenApi.unknown()).optional(),
          }),
        )
        .min(1)
        .max(10),
      execution_mode: zOpenApi.enum(['sequential', 'parallel']).optional(),
      stop_on_error: zOpenApi.boolean().optional(),
      notification_email: zOpenApi.string().email().optional(),
    }),
  );

  const HealthConfigBody = registry.registerSchema(
    'QuickBooksV1HealthConfigBody',
    zOpenApi.object({
      monitoring_enabled: zOpenApi.boolean().optional(),
      check_interval: zOpenApi.number().int().min(1).optional(),
      alert_thresholds: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const ApiError = registry.registerSchema(
    'QuickBooksV1ApiError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const ApiSuccess = registry.registerSchema(
    'QuickBooksV1ApiSuccess',
    zOpenApi.object({
      data: zOpenApi.unknown(),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const ApiPaginated = registry.registerSchema(
    'QuickBooksV1ApiPaginated',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.unknown()),
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

  type RouteDef = {
    method: 'get' | 'post' | 'put' | 'delete';
    suffix: string;
    handler: string;
    summary: string;
    description: string;
    action: 'read' | 'write' | 'admin';
  };

  const defs: RouteDef[] = [
    { method: 'get', suffix: '/accounts', handler: 'getAccounts', summary: 'Get QuickBooks chart of accounts', description: 'Returns QuickBooks accounts list; current implementation is a stub empty array.', action: 'read' },
    { method: 'get', suffix: '/accounts/mappings', handler: 'getAccountMappings', summary: 'List account mappings', description: 'Returns paginated account mapping configuration; current implementation is stubbed.', action: 'read' },
    { method: 'put', suffix: '/accounts/mappings', handler: 'configureAccountMappings', summary: 'Configure account mappings', description: 'Stores/updates account mapping configuration for integration export/import.', action: 'write' },
    { method: 'post', suffix: '/connection/refresh', handler: 'refreshConnection', summary: 'Refresh QuickBooks connection tokens', description: 'Refresh endpoint currently returns synthetic success payload (service TODO).', action: 'write' },
    { method: 'get', suffix: '/connection/status', handler: 'getConnectionStatus', summary: 'Get QuickBooks connection status', description: 'Returns tenant connection status and quick links for integration actions.', action: 'read' },
    { method: 'post', suffix: '/connection/test', handler: 'testConnection', summary: 'Run QuickBooks connection test', description: 'Runs connection diagnostics against configured QuickBooks tenant.', action: 'read' },
    { method: 'get', suffix: '/customers/mappings', handler: 'getCustomerMappings', summary: 'List customer mappings', description: 'Returns paginated customer mapping records.', action: 'read' },
    { method: 'delete', suffix: '/customers/mappings/{mapping_id}', handler: 'deleteCustomerMapping', summary: 'Delete customer mapping', description: 'Delete handler currently returns 204 stub response (service TODO).', action: 'write' },
    { method: 'post', suffix: '/customers/sync', handler: 'syncCustomers', summary: 'Sync customers', description: 'Synchronizes customer entities between Alga and QuickBooks.', action: 'write' },
    { method: 'post', suffix: '/diagnostics', handler: 'runDiagnostics', summary: 'Run QuickBooks diagnostics', description: 'Runs diagnostic checks; current implementation returns synthetic health data.', action: 'admin' },
    { method: 'get', suffix: '/health', handler: 'getHealth', summary: 'Get integration health', description: 'Returns integration health summary from QuickBooksService.', action: 'read' },
    { method: 'get', suffix: '/health/config', handler: 'getHealthConfig', summary: 'Get health monitoring config', description: 'Returns health monitoring configuration; current implementation is stubbed.', action: 'read' },
    { method: 'put', suffix: '/health/config', handler: 'updateHealthConfig', summary: 'Update health monitoring config', description: 'Updates health monitoring configuration (controller-side synthetic response).', action: 'admin' },
    { method: 'post', suffix: '/invoices/export', handler: 'exportInvoices', summary: 'Export invoices to QuickBooks', description: 'Exports selected invoices to QuickBooks and returns job/result metadata.', action: 'write' },
    { method: 'post', suffix: '/invoices/import', handler: 'importInvoices', summary: 'Import invoices from QuickBooks', description: 'Imports QuickBooks invoices into Alga with optional upsert behavior.', action: 'write' },
    { method: 'get', suffix: '/items', handler: 'getItems', summary: 'List QuickBooks items', description: 'Returns items/services catalog; current implementation returns sample stub rows.', action: 'read' },
    { method: 'get', suffix: '/mappings', handler: 'getDataMappings', summary: 'List data mappings', description: 'Returns paginated list of generic QuickBooks data mapping configurations.', action: 'read' },
    { method: 'post', suffix: '/mappings', handler: 'createDataMapping', summary: 'Create data mapping', description: 'Creates one data mapping configuration; current implementation returns synthetic mapping id.', action: 'write' },
    { method: 'get', suffix: '/mappings/{mapping_id}', handler: 'getDataMappingById', summary: 'Get data mapping by id', description: 'Returns one data mapping record by mapping_id.', action: 'read' },
    { method: 'put', suffix: '/mappings/{mapping_id}', handler: 'updateDataMapping', summary: 'Update data mapping', description: 'Updates one data mapping configuration by mapping_id.', action: 'write' },
    { method: 'delete', suffix: '/mappings/{mapping_id}', handler: 'deleteDataMapping', summary: 'Delete data mapping', description: 'Deletes one data mapping configuration (current controller returns 204 stub).', action: 'write' },
    { method: 'post', suffix: '/oauth/callback', handler: 'handleOAuthCallback', summary: 'Handle QuickBooks OAuth callback payload', description: 'Consumes OAuth callback payload with code/state/realm and persists connection tokens.', action: 'write' },
    { method: 'delete', suffix: '/oauth/disconnect', handler: 'disconnectOAuth', summary: 'Disconnect QuickBooks OAuth', description: 'Revokes/disconnects QuickBooks tenant credentials and returns 204.', action: 'admin' },
    { method: 'post', suffix: '/oauth/initiate', handler: 'initiateOAuth', summary: 'Initiate QuickBooks OAuth flow', description: 'Generates authorization URL for QuickBooks OAuth with tenant-scoped state.', action: 'write' },
    { method: 'get', suffix: '/payment-methods', handler: 'getPaymentMethods', summary: 'List QuickBooks payment methods', description: 'Returns payment methods; current implementation returns sample stub rows.', action: 'read' },
    { method: 'post', suffix: '/payments/sync', handler: 'syncPayments', summary: 'Sync payments', description: 'Synchronizes payment records between Alga and QuickBooks.', action: 'write' },
    { method: 'post', suffix: '/sync/bulk', handler: 'bulkSync', summary: 'Run bulk QuickBooks sync', description: 'Starts multi-operation bulk sync and returns accepted job payload.', action: 'write' },
    { method: 'post', suffix: '/sync/full', handler: 'fullSync', summary: 'Run full QuickBooks sync', description: 'Starts full synchronization workflow and returns accepted job payload.', action: 'admin' },
    { method: 'get', suffix: '/sync/history', handler: 'getSyncHistory', summary: 'List sync history', description: 'Returns paginated synchronization history with status/type/date filters.', action: 'read' },
    { method: 'get', suffix: '/sync/status', handler: 'getSyncStatus', summary: 'Get current sync status', description: 'Returns current sync status summary (currently stub status payload).', action: 'read' },
    { method: 'get', suffix: '/sync/status/{sync_id}', handler: 'getSyncStatusById', summary: 'Get sync status by id', description: 'Returns detailed status for one sync operation id.', action: 'read' },
    { method: 'post', suffix: '/sync/{sync_id}/cancel', handler: 'cancelSync', summary: 'Cancel sync operation', description: 'Cancel endpoint currently returns 204 stub response (service TODO).', action: 'write' },
    { method: 'post', suffix: '/sync/{sync_id}/retry', handler: 'retrySync', summary: 'Retry sync operation', description: 'Retries a failed sync and returns synthetic new retry sync id.', action: 'write' },
    { method: 'get', suffix: '/tax-codes', handler: 'getTaxCodes', summary: 'List QuickBooks tax codes', description: 'Returns tax code list; current implementation is a stub empty array.', action: 'read' },
    { method: 'get', suffix: '/tax-codes/mappings', handler: 'getTaxMappings', summary: 'List tax mappings', description: 'Returns paginated tax mapping configuration; current implementation is stubbed.', action: 'read' },
    { method: 'put', suffix: '/tax-codes/mappings', handler: 'configureTaxMappings', summary: 'Configure tax mappings', description: 'Stores/updates mapping from Alga tax regions to QuickBooks tax codes.', action: 'write' },
    { method: 'get', suffix: '/terms', handler: 'getTerms', summary: 'List QuickBooks terms', description: 'Returns payment terms catalog; current implementation returns sample stub rows.', action: 'read' },
  ];

  const commonExtensions = {
    'x-tenant-scoped': true,
    'x-auth-mechanism': 'x-api-key validated by ApiQuickBooksController.authenticate()',
    'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
    'x-rbac-resource': 'quickbooks',
  };

  function requestForHandler(handler: string, suffix: string) {
    const req: Record<string, unknown> = {};

    if (suffix.includes('{mapping_id}')) {
      req.params = MappingIdParam;
    }
    if (suffix.includes('{sync_id}')) {
      req.params = SyncIdParam;
    }

    if (['getAccounts', 'getCustomerMappings', 'getTaxCodes', 'getItems', 'getPaymentMethods', 'getTerms'].includes(handler)) {
      req.query = QboEntityQuery;
    }
    if (handler === 'getSyncHistory') {
      req.query = SyncHistoryQuery;
    }
    if (handler === 'getDataMappings') {
      req.query = QboEntityQuery;
    }

    if (handler === 'initiateOAuth') req.body = { schema: OAuthInitiateBody };
    if (handler === 'handleOAuthCallback') req.body = { schema: OAuthCallbackBody };
    if (handler === 'testConnection') req.body = { schema: ConnectionTestBody };
    if (handler === 'syncCustomers') req.body = { schema: CustomerSyncBody };
    if (handler === 'exportInvoices') req.body = { schema: InvoiceExportBody };
    if (handler === 'importInvoices') req.body = { schema: InvoiceImportBody };
    if (handler === 'syncPayments') req.body = { schema: PaymentSyncBody };
    if (handler === 'configureAccountMappings') req.body = { schema: AccountMappingsBody };
    if (handler === 'configureTaxMappings') req.body = { schema: TaxMappingsBody };
    if (handler === 'createDataMapping' || handler === 'updateDataMapping') req.body = { schema: DataMappingBody };
    if (handler === 'bulkSync') req.body = { schema: BulkSyncBody };
    if (handler === 'updateHealthConfig') req.body = { schema: HealthConfigBody };

    return req;
  }

  function responsesForHandler(handler: string) {
    const responses: Record<number, any> = {
      400: { description: 'Validation or request parsing failure.', schema: ApiError },
      401: { description: 'API key missing/invalid or associated user missing.', schema: ApiError },
      403: { description: 'QuickBooks RBAC permission denied.', schema: ApiError },
      500: { description: 'Unexpected QuickBooks endpoint failure.', schema: ApiError },
    };

    if (['disconnectOAuth', 'deleteCustomerMapping', 'cancelSync', 'deleteDataMapping'].includes(handler)) {
      responses[204] = { description: 'Operation completed with no response body.', emptyBody: true };
      return responses;
    }

    if (['bulkSync', 'fullSync'].includes(handler)) {
      responses[202] = { description: 'Async sync job accepted.', schema: ApiSuccess };
      return responses;
    }

    if (handler === 'createDataMapping') {
      responses[201] = { description: 'Mapping created.', schema: ApiSuccess };
      return responses;
    }

    if (['getAccountMappings', 'getCustomerMappings', 'getTaxMappings', 'getSyncHistory', 'getDataMappings'].includes(handler)) {
      responses[200] = { description: 'Paginated records returned.', schema: ApiPaginated };
      return responses;
    }

    responses[200] = { description: 'QuickBooks operation succeeded.', schema: ApiSuccess };

    if (['getDataMappingById', 'getSyncStatusById'].includes(handler)) {
      responses[404] = { description: 'Requested mapping/sync record not found.', schema: ApiError };
    }

    return responses;
  }

  const families = [
    {
      prefix: '/api/v1/integrations/quickbooks',
      variant: 'integrations',
      aliasNote:
        'This family uses route handlers that instantiate ApiQuickBooksController and usually wrap calls in explicit try/catch handleApiError blocks.',
    },
    {
      prefix: '/api/v1/quickbooks',
      variant: 'quickbooks',
      aliasNote:
        'This family is a path alias that binds controller methods directly (for example `export const GET = controller.getAccounts()`) and relies on controller-level error handling.',
    },
  ] as const;

  for (const family of families) {
    for (const def of defs) {
      registry.registerRoute({
        method: def.method,
        path: `${family.prefix}${def.suffix}`,
        summary: def.summary,
        description:
          `${def.description} Both /api/v1/integrations/quickbooks/* and /api/v1/quickbooks/* map to the same ApiQuickBooksController method (${def.handler}). ${family.aliasNote}`,
        tags: [tag],
        security: [{ ApiKeyAuth: [] }],
        request: requestForHandler(def.handler, def.suffix),
        responses: responsesForHandler(def.handler),
        extensions: {
          ...commonExtensions,
          'x-rbac-action': def.action,
          'x-controller-method': `ApiQuickBooksController.${def.handler}()`,
          'x-quickbooks-route-family': family.variant,
          'x-quickbooks-alias-path': def.suffix,
          'x-quickbooks-family-alias': true,
        },
        edition: 'both',
      });
    }
  }
}
