import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

/**
 * Real metadata for assorted single-endpoint public resources that were
 * previously served by the route-inventory backfill (placeholder descriptions).
 * Documents each endpoint as it actually behaves — including namespace-root
 * 404s, EE-gated features, and deprecated aliases.
 */
export function registerPublicResourcesV1Routes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const err = deps.ErrorResponse;
  const Success = registry.registerSchema(
    'PublicV1Success',
    zOpenApi.object({
      data: zOpenApi.union([zOpenApi.record(zOpenApi.unknown()), zOpenApi.array(zOpenApi.record(zOpenApi.unknown()))]),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const stdErrs = (extra?: Record<number, string>) => ({
    400: { description: 'Invalid request.', schema: err },
    401: { description: 'API key missing/invalid.', schema: err },
    403: { description: 'Caller lacks the required permission.', schema: err },
    ...(extra ? Object.fromEntries(Object.entries(extra).map(([c, d]) => [Number(c), { description: d, schema: err }])) : {}),
    500: { description: 'Unexpected error.', schema: err },
  });

  // Namespace-root 404 stubs — no resource of their own; point to sub-resources.
  const namespaceRoot = (path: string, name: string, hint: string) =>
    registry.registerRoute({
      method: 'get', path,
      summary: `${name} API namespace root`,
      description: `Namespace root with no resource of its own — it returns 404. ${hint}`,
      tags: [name], security: [{ ApiKeyAuth: [] }],
      responses: {
        404: { description: 'Always — this root has no resource; call a sub-resource path.', schema: err },
        401: { description: 'API key missing/invalid.', schema: err },
      },
      extensions: { 'x-namespace-root': true },
      edition: 'both',
    });

  namespaceRoot('/api/v1/billing', 'Billing', 'Use /api/v1/financial/invoices, /api/v1/financial/transactions, /api/v1/financial/credits, and /api/v1/billing-analytics/overview.');
  namespaceRoot('/api/v1/comments', 'Comments', 'Comments are accessed per ticket: /api/v1/tickets/{id}/comments and its sub-paths.');
  namespaceRoot('/api/v1/documents', 'Documents', 'Documents are accessed per parent entity, e.g. /api/v1/tickets/{id}/documents.');
  namespaceRoot('/api/v1/email', 'Email', 'Use the email provider and webhook endpoints rather than this root.');

  // AI document assist (EE-gated, streaming).
  registry.registerRoute({
    method: 'post', path: '/api/v1/ai/document-assist',
    summary: 'AI document assistance (streaming, EE)',
    description: 'Streams AI-generated document edits using the tenant\'s configured LLM provider. Enterprise Edition feature gated by the AI add-on tier and a feature flag; authenticated with the AI_DOCUMENT_API_KEY via the x-api-key header. Returns a streamed text response (501 on Community Edition).',
    tags: ['AI'], security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: registry.registerSchema('AiDocumentAssistBody', zOpenApi.object({
      instruction: zOpenApi.string().describe('What the assistant should do.'),
      documentContext: zOpenApi.string().describe('Current document text/context.'),
      documentId: zOpenApi.string().uuid().optional(),
      tenantId: zOpenApi.string().uuid(),
      connectedUserNames: zOpenApi.array(zOpenApi.string()).optional(),
    })) } },
    responses: {
      200: { description: 'Streamed AI edit suggestions (text/event-stream).', schema: Success },
      401: { description: 'AI_DOCUMENT_API_KEY missing/invalid.', schema: err },
      403: { description: 'AI add-on/feature flag not enabled.', schema: err },
      501: { description: 'Not available on Community Edition.', schema: err },
      500: { description: 'Unexpected error.', schema: err },
    },
    extensions: { 'x-edition-feature': 'ee-ai', 'x-streaming': true },
    edition: 'both',
  });

  // Fleet-wide software search.
  registry.registerRoute({
    method: 'get', path: '/api/v1/software/search',
    summary: 'Search software across the fleet',
    description: 'Searches installed software across all assets in the tenant, with filters for name/publisher search, category, software_type, is_managed, is_security_relevant, and client_id. Paginated. Authenticated by the global x-api-key middleware and tenant-scoped by the underlying withAuth action (it calls the searchSoftwareFleetWide server action directly rather than using a route-level controller wrapper).',
    tags: ['Software'], security: [{ ApiKeyAuth: [] }],
    request: { query: registry.registerSchema('SoftwareSearchQuery', zOpenApi.object({
      search: zOpenApi.string().optional(),
      category: zOpenApi.string().optional(),
      software_type: zOpenApi.string().optional(),
      is_managed: zOpenApi.enum(['true', 'false']).optional(),
      is_security_relevant: zOpenApi.enum(['true', 'false']).optional(),
      client_id: zOpenApi.string().uuid().optional(),
      page: zOpenApi.number().int().min(1).optional(),
      limit: zOpenApi.number().int().min(1).max(200).optional(),
    })) },
    responses: { 200: { description: 'Matching software, paginated.', schema: Success }, ...stdErrs() },
    extensions: { 'x-tenant-scoped': true, 'x-auth-via': 'middleware-apikey+withAuth-action' },
    edition: 'both',
  });

  // Priorities.
  registry.registerRoute({
    method: 'get', path: '/api/v1/priorities',
    summary: 'List priorities',
    description: 'Lists ticket priorities for the tenant with pagination and sorting.',
    tags: ['Priorities'], security: [{ ApiKeyAuth: [] }],
    request: { query: registry.registerSchema('PriorityListQuery', zOpenApi.object({
      page: zOpenApi.number().int().min(1).optional(),
      limit: zOpenApi.number().int().min(1).max(100).optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
    })) },
    responses: { 200: { description: 'Priorities.', schema: Success }, ...stdErrs() },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'ticket', 'x-rbac-action': 'read' },
    edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/v1/priorities/{id}',
    summary: 'Get a priority',
    description: 'Returns a single priority by id.',
    tags: ['Priorities'], security: [{ ApiKeyAuth: [] }],
    request: { params: registry.registerSchema('PriorityIdParam', zOpenApi.object({ id: zOpenApi.string().uuid() })) },
    responses: { 200: { description: 'The priority.', schema: Success }, ...stdErrs({ 404: 'Priority not found.' }) },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'ticket', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  // Extensions (EE-only; 501 on CE).
  const ExtensionActionBody = registry.registerSchema('ExtensionActionBody', zOpenApi.record(zOpenApi.unknown()).describe('Extension install/uninstall payload (handled by the EE extension service).'));
  for (const action of ['install', 'uninstall'] as const) {
    registry.registerRoute({
      method: 'post', path: `/api/v1/extensions/${action}`,
      summary: `${action[0].toUpperCase()}${action.slice(1)} an extension (EE)`,
      description: `${action[0].toUpperCase()}${action.slice(1)}s a tenant extension. Enterprise Edition feature requiring the extensions capability and the psa product; returns 501 on Community Edition.`,
      tags: ['Extensions'], security: [{ ApiKeyAuth: [] }],
      request: { body: { schema: ExtensionActionBody } },
      responses: {
        200: { description: `Extension ${action} accepted.`, schema: Success },
        401: { description: 'API key missing/invalid.', schema: err },
        403: { description: 'Extensions capability/product not available.', schema: err },
        501: { description: 'Not available on Community Edition.', schema: err },
        500: { description: 'Unexpected error.', schema: err },
      },
      extensions: { 'x-edition-feature': 'ee-extensions' },
      edition: 'both',
    });
  }

  // Company contract lines (DEPRECATED alias of client-contract-lines).
  const ccLineDeprecation = 'Deprecated: use /api/v1/client-contract-lines. This path is an alias kept for backwards compatibility.';
  registry.registerRoute({
    method: 'get', path: '/api/v1/company-contract-lines',
    summary: 'List company contract lines (deprecated)',
    description: `Lists client contract lines (contract_lines joined to client contracts), with filters and pagination. ${ccLineDeprecation}`,
    tags: ['Contract Lines'], security: [{ ApiKeyAuth: [] }],
    request: { query: registry.registerSchema('CompanyContractLineListQuery', zOpenApi.object({
      page: zOpenApi.number().int().min(1).optional(),
      limit: zOpenApi.number().int().min(1).max(100).optional(),
      client_id: zOpenApi.string().uuid().optional(),
      contract_line_id: zOpenApi.string().uuid().optional(),
    })) },
    responses: { 200: { description: 'Client contract lines.', schema: Success }, ...stdErrs() },
    extensions: { 'x-tenant-scoped': true, 'x-deprecated': true, 'x-replaced-by': '/api/v1/client-contract-lines' },
    edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/v1/company-contract-lines',
    summary: 'Assign contract line to client (deprecated)',
    description: `Assigns a contract line to a client by cloning a template line into the client contract. ${ccLineDeprecation}`,
    tags: ['Contract Lines'], security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: registry.registerSchema('CompanyContractLineBody', zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      contract_line_id: zOpenApi.string().uuid(),
      client_contract_id: zOpenApi.string().uuid().optional(),
      custom_rate: zOpenApi.number().optional(),
    })) } },
    responses: { 201: { description: 'Assignment created.', schema: Success }, ...stdErrs() },
    extensions: { 'x-tenant-scoped': true, 'x-deprecated': true, 'x-replaced-by': '/api/v1/client-contract-lines' },
    edition: 'both',
  });
  registry.registerRoute({
    method: 'delete', path: '/api/v1/company-contract-lines/{id}',
    summary: 'Unassign contract line (deprecated)',
    description: `Deactivates a client-owned contract line by id. ${ccLineDeprecation}`,
    tags: ['Contract Lines'], security: [{ ApiKeyAuth: [] }],
    request: { params: registry.registerSchema('CompanyContractLineIdParam', zOpenApi.object({ id: zOpenApi.string().uuid() })) },
    responses: { 204: { description: 'Unassigned.', emptyBody: true }, ...stdErrs({ 404: 'Not found.' }) },
    extensions: { 'x-tenant-scoped': true, 'x-deprecated': true, 'x-replaced-by': '/api/v1/client-contract-lines' },
    edition: 'both',
  });

  // Accounting exports (Xero CSV).
  registry.registerRoute({
    method: 'get', path: '/api/v1/accounting-exports/xero-csv/client-export',
    summary: 'Export clients as Xero Contacts CSV',
    description: 'Generates a Xero Contacts import CSV from the tenant clients (optionally limited to clientIds). Returns a CSV file. Requires billing:manage.',
    tags: ['Accounting Exports'], security: [{ ApiKeyAuth: [] }],
    request: { query: registry.registerSchema('XeroClientExportQuery', zOpenApi.object({ clientIds: zOpenApi.string().optional().describe('Comma-separated client UUIDs to limit the export.') })) },
    responses: { 200: { description: 'CSV file (text/csv attachment).', schema: Success }, ...stdErrs() },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'billing', 'x-rbac-action': 'manage', 'x-response-content-type': 'text/csv' },
    edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/v1/accounting-exports/xero-csv/client-import',
    summary: 'Import Xero Contacts CSV',
    description: 'Ingests a Xero Contacts CSV and matches/creates/updates clients. Accepts multipart file, JSON csvContent, or raw CSV. Supports preview mode and createNew/updateExisting/matchBy options. Requires billing:manage.',
    tags: ['Accounting Exports'], security: [{ ApiKeyAuth: [] }],
    request: { query: registry.registerSchema('XeroClientImportQuery', zOpenApi.object({
      preview: zOpenApi.enum(['true', 'false']).optional(),
      createNew: zOpenApi.enum(['true', 'false']).optional(),
      updateExisting: zOpenApi.enum(['true', 'false']).optional(),
      matchBy: zOpenApi.string().optional(),
    })) },
    responses: { 200: { description: 'Import preview or result.', schema: Success }, ...stdErrs() },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'billing', 'x-rbac-action': 'manage', 'x-request-content-type': 'multipart/form-data or application/json or text/csv' },
    edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/v1/accounting-exports/xero-csv/tax-import',
    summary: 'Import Xero invoice tax CSV',
    description: 'Ingests a Xero Invoice Details Report CSV, extracts per-invoice tax amounts, and updates the matching Alga invoices. Accepts multipart file, JSON csvContent, or raw CSV; supports preview mode. Requires billing:manage.',
    tags: ['Accounting Exports'], security: [{ ApiKeyAuth: [] }],
    request: { query: registry.registerSchema('XeroTaxImportQuery', zOpenApi.object({ preview: zOpenApi.enum(['true', 'false']).optional() })) },
    responses: { 200: { description: 'Import preview or result.', schema: Success }, ...stdErrs() },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'billing', 'x-rbac-action': 'manage', 'x-request-content-type': 'multipart/form-data or application/json or text/csv' },
    edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/v1/accounting-exports/{batchId}/download',
    summary: 'Download an accounting export batch',
    description: 'Regenerates and returns the export file (CSV/IIF) for a stored export batch using its registered adapter (xero_csv, quickbooks_desktop). Requires billing_settings:update.',
    tags: ['Accounting Exports'], security: [{ ApiKeyAuth: [] }],
    request: { params: registry.registerSchema('AccountingBatchIdParam', zOpenApi.object({ batchId: zOpenApi.string().describe('Export batch identifier.') })) },
    responses: { 200: { description: 'Regenerated export file (attachment).', schema: Success }, ...stdErrs({ 404: 'Batch not found.' }) },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'billing_settings', 'x-rbac-action': 'update' },
    edition: 'both',
  });
}
