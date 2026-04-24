import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerClientContactRoutes(registry: ApiOpenApiRegistry) {
  const clientTag = 'Clients';
  const contactTag = 'Contacts';
  const contractTag = 'Client Contract Lines';

  const ClientIdParam = registry.registerSchema('ClientIdParam', zOpenApi.object({ id: zOpenApi.string().uuid() }));
  const ContactIdParam = registry.registerSchema('ContactIdParam', zOpenApi.object({ id: zOpenApi.string().uuid() }));
  const ClientContractLineIdParam = registry.registerSchema(
    'ClientContractLineIdParam',
    zOpenApi.object({ id: zOpenApi.string().uuid() }),
  );

  const ClientListQuery = registry.registerSchema(
    'ClientListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      search: zOpenApi.string().optional(),
      created_from: zOpenApi.string().datetime().optional(),
      created_to: zOpenApi.string().datetime().optional(),
      updated_from: zOpenApi.string().datetime().optional(),
      updated_to: zOpenApi.string().datetime().optional(),
      client_name: zOpenApi.string().optional(),
      email: zOpenApi.string().optional(),
      client_type: zOpenApi.string().optional(),
      billing_cycle: zOpenApi.enum(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']).optional(),
      is_inactive: zOpenApi.enum(['true', 'false']).optional(),
      is_tax_exempt: zOpenApi.enum(['true', 'false']).optional(),
      account_manager_id: zOpenApi.string().uuid().optional(),
      region_code: zOpenApi.string().optional(),
      credit_balance_min: zOpenApi.string().optional(),
      credit_balance_max: zOpenApi.string().optional(),
      has_credit_limit: zOpenApi.enum(['true', 'false']).optional(),
      industry: zOpenApi.string().optional(),
      company_size: zOpenApi.string().optional(),
    }),
  );

  const ClientBody = registry.registerSchema(
    'ClientBody',
    zOpenApi.object({
      client_name: zOpenApi.string().min(1).max(255),
      phone_no: zOpenApi.string().optional(),
      email: zOpenApi.string().email().optional(),
      url: zOpenApi.string().url().optional(),
      address: zOpenApi.string().optional(),
      client_type: zOpenApi.string().optional(),
      tax_id_number: zOpenApi.string().optional(),
      notes: zOpenApi.string().optional(),
      properties: zOpenApi.record(zOpenApi.unknown()).optional(),
      payment_terms: zOpenApi.string().optional(),
      billing_cycle: zOpenApi.enum(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']),
      credit_limit: zOpenApi.number().min(0).optional(),
      preferred_payment_method: zOpenApi.string().optional(),
      auto_invoice: zOpenApi.boolean().optional(),
      invoice_delivery_method: zOpenApi.enum(['email', 'mail', 'portal']).optional(),
      region_code: zOpenApi.string().optional(),
      is_tax_exempt: zOpenApi.boolean().optional(),
      tax_exemption_certificate: zOpenApi.string().optional(),
      timezone: zOpenApi.string().optional(),
      invoice_template_id: zOpenApi.string().uuid().optional(),
      billing_contact_id: zOpenApi.string().uuid().optional(),
      billing_email: zOpenApi.string().email().optional(),
      account_manager_id: zOpenApi.string().uuid().optional(),
      is_inactive: zOpenApi.boolean().optional(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
    }),
  );

  const ClientLocationBody = registry.registerSchema(
    'ClientLocationBody',
    zOpenApi.object({
      location_name: zOpenApi.string().optional(),
      address_line1: zOpenApi.string().min(1),
      address_line2: zOpenApi.string().optional(),
      address_line3: zOpenApi.string().optional(),
      city: zOpenApi.string().min(1),
      state_province: zOpenApi.string().optional(),
      postal_code: zOpenApi.string().optional(),
      country_code: zOpenApi.string().min(2).max(3),
      country_name: zOpenApi.string().min(1),
      region_code: zOpenApi.string().optional(),
      is_billing_address: zOpenApi.boolean().optional(),
      is_shipping_address: zOpenApi.boolean().optional(),
      is_default: zOpenApi.boolean().optional(),
      phone: zOpenApi.string().optional(),
      fax: zOpenApi.string().optional(),
      email: zOpenApi.string().email().optional(),
      notes: zOpenApi.string().optional(),
      is_active: zOpenApi.boolean().optional(),
    }),
  );

  const ContactListQuery = registry.registerSchema(
    'ContactListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      search: zOpenApi.string().optional(),
      created_from: zOpenApi.string().datetime().optional(),
      created_to: zOpenApi.string().datetime().optional(),
      updated_from: zOpenApi.string().datetime().optional(),
      updated_to: zOpenApi.string().datetime().optional(),
      full_name: zOpenApi.string().optional(),
      email: zOpenApi.string().optional(),
      phone_number: zOpenApi.string().optional(),
      client_id: zOpenApi.string().uuid().optional(),
      role: zOpenApi.string().optional(),
      is_inactive: zOpenApi.enum(['true', 'false']).optional(),
      has_client: zOpenApi.enum(['true', 'false']).optional(),
      client_name: zOpenApi.string().optional(),
    }),
  );

  const ContactBody = registry.registerSchema(
    'ContactBody',
    zOpenApi.object({
      full_name: zOpenApi.string().min(1).max(255),
      client_id: zOpenApi.string().uuid().optional(),
      phone_numbers: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
      email: zOpenApi.string().email(),
      primary_email_canonical_type: zOpenApi.string().optional().nullable(),
      primary_email_custom_type: zOpenApi.string().optional().nullable(),
      primary_email_custom_type_id: zOpenApi.string().uuid().optional().nullable(),
      additional_email_addresses: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
      role: zOpenApi.string().optional(),
      notes: zOpenApi.string().optional(),
      is_inactive: zOpenApi.boolean().optional(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
    }),
  );

  const ContactSearchQuery = registry.registerSchema(
    'ContactSearchQuery',
    zOpenApi.object({
      query: zOpenApi.string().min(1),
      fields: zOpenApi.string().optional().describe('Comma-separated field list; parsed by contactSearchSchema transform.'),
      client_id: zOpenApi.string().uuid().optional(),
      include_inactive: zOpenApi.enum(['true', 'false']).optional(),
      limit: zOpenApi.string().optional(),
    }),
  );

  const ContactExportQuery = registry.registerSchema(
    'ContactExportQuery',
    zOpenApi.object({
      format: zOpenApi.enum(['csv', 'json']).optional(),
      include_inactive: zOpenApi.enum(['true', 'false']).optional(),
      client_id: zOpenApi.string().uuid().optional(),
      fields: zOpenApi.string().optional().describe('Array schema expects parsed list, but URL values arrive as string.'),
    }),
  );

  const ClientContractLineQuery = registry.registerSchema(
    'ClientContractLineQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      search: zOpenApi.string().optional(),
      created_from: zOpenApi.string().datetime().optional(),
      created_to: zOpenApi.string().datetime().optional(),
      updated_from: zOpenApi.string().datetime().optional(),
      updated_to: zOpenApi.string().datetime().optional(),
      client_id: zOpenApi.string().uuid().optional(),
      contract_line_id: zOpenApi.string().uuid().optional(),
      service_category: zOpenApi.string().optional(),
      is_active: zOpenApi.enum(['true', 'false']).optional(),
      has_custom_rate: zOpenApi.enum(['true', 'false']).optional(),
      is_contractd: zOpenApi.enum(['true', 'false']).optional(),
      start_date_from: zOpenApi.string().datetime().optional(),
      start_date_to: zOpenApi.string().datetime().optional(),
      end_date_from: zOpenApi.string().datetime().optional(),
      end_date_to: zOpenApi.string().datetime().optional(),
    }),
  );

  const ClientContractLineBody = registry.registerSchema(
    'ClientContractLineBody',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      contract_line_id: zOpenApi.string().uuid(),
      service_category: zOpenApi.string().optional(),
      start_date: zOpenApi.string().datetime(),
      end_date: zOpenApi.string().datetime().optional(),
      is_active: zOpenApi.boolean().optional(),
      custom_rate: zOpenApi.number().min(0).optional(),
      client_contract_id: zOpenApi.string().uuid().optional(),
    }),
  );

  const ApiError = registry.registerSchema(
    'ClientContactApiError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const ApiSuccess = registry.registerSchema('ClientContactApiSuccess', zOpenApi.object({ data: zOpenApi.unknown(), meta: zOpenApi.record(zOpenApi.unknown()).optional() }));

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients',
    summary: 'List clients',
    description: 'Inherited ApiBaseController list route for clients. Requires API-key auth and client:read permission.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ClientListQuery },
    responses: {
      200: { description: 'Paginated clients returned.', schema: ApiSuccess },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client read.', schema: ApiError },
      500: { description: 'Unexpected client listing failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/clients',
    summary: 'Create client',
    description: 'Inherited ApiBaseController create route for clients. Requires API-key auth and client:create permission.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: ClientBody } },
    responses: {
      201: { description: 'Client created.', schema: ApiSuccess },
      400: { description: 'Invalid request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client create.', schema: ApiError },
      500: { description: 'Unexpected client creation failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'create' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients/{id}',
    summary: 'Get client',
    description: 'Inherited ApiBaseController get route for one client_id.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientIdParam },
    responses: {
      200: { description: 'Client returned.', schema: ApiSuccess },
      400: { description: 'Invalid client id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client read.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected client retrieval failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/clients/{id}',
    summary: 'Update client',
    description: 'Inherited ApiBaseController update route for one client_id.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientIdParam, body: { schema: ClientBody.partial() } },
    responses: {
      200: { description: 'Client updated.', schema: ApiSuccess },
      400: { description: 'Invalid client id or request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client update.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected client update failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/clients/{id}',
    summary: 'Delete client',
    description: 'Inherited ApiBaseController delete route for one client_id.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientIdParam },
    responses: {
      204: { description: 'Client deleted.', emptyBody: true },
      400: { description: 'Invalid client id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client delete.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected client deletion failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'delete' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients/stats',
    summary: 'Get client stats',
    description: 'Client statistics route with explicit API-key validation and client:read permission check.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Client stats returned.', schema: ApiSuccess },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client read.', schema: ApiError },
      500: { description: 'Unexpected client stats failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients/{id}/contacts',
    summary: 'List contacts for client',
    description: 'Returns paginated contacts filtered by client_id after client existence check.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientIdParam },
    responses: {
      200: { description: 'Client contacts returned.', schema: ApiSuccess },
      400: { description: 'Invalid client id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client read.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected client contacts failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients/{id}/locations',
    summary: 'List client locations',
    description: 'Returns locations associated with client_id after client existence check.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientIdParam },
    responses: {
      200: { description: 'Client locations returned.', schema: ApiSuccess },
      400: { description: 'Invalid client id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client read.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected client locations failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read', 'x-deprecated-route-commented': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/clients/{id}/locations',
    summary: 'Create client location',
    description: 'Creates a location row for client_id after validation and client existence check.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientIdParam, body: { schema: ClientLocationBody } },
    responses: {
      201: { description: 'Client location created.', schema: ApiSuccess },
      400: { description: 'Invalid client id or request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client update.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected client location creation failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'update', 'x-deprecated-route-commented': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contacts',
    summary: 'List contacts',
    description: 'Inherited ApiBaseController list route for contacts.',
    tags: [contactTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ContactListQuery },
    responses: {
      200: { description: 'Paginated contacts returned.', schema: ApiSuccess },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for contact read.', schema: ApiError },
      500: { description: 'Unexpected contact listing failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'contact', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contacts',
    summary: 'Create contact',
    description: 'Inherited ApiBaseController create route for contacts.',
    tags: [contactTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: ContactBody } },
    responses: {
      201: { description: 'Contact created.', schema: ApiSuccess },
      400: { description: 'Invalid request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for contact create.', schema: ApiError },
      500: { description: 'Unexpected contact creation failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'contact', 'x-rbac-action': 'create' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contacts/{id}',
    summary: 'Get contact',
    description: 'Inherited ApiBaseController get route for one contact_name_id.',
    tags: [contactTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContactIdParam },
    responses: {
      200: { description: 'Contact returned.', schema: ApiSuccess },
      400: { description: 'Invalid contact id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for contact read.', schema: ApiError },
      404: { description: 'Contact not found.', schema: ApiError },
      500: { description: 'Unexpected contact retrieval failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'contact', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/contacts/{id}',
    summary: 'Update contact',
    description: 'Inherited ApiBaseController update route for one contact_name_id.',
    tags: [contactTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContactIdParam, body: { schema: ContactBody.partial() } },
    responses: {
      200: { description: 'Contact updated.', schema: ApiSuccess },
      400: { description: 'Invalid contact id or request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for contact update.', schema: ApiError },
      404: { description: 'Contact not found.', schema: ApiError },
      500: { description: 'Unexpected contact update failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'contact', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/contacts/{id}',
    summary: 'Delete contact',
    description: 'Inherited ApiBaseController delete route for one contact_name_id.',
    tags: [contactTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContactIdParam },
    responses: {
      204: { description: 'Contact deleted.', emptyBody: true },
      400: { description: 'Invalid contact id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for contact delete.', schema: ApiError },
      404: { description: 'Contact not found.', schema: ApiError },
      500: { description: 'Unexpected contact deletion failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'contact', 'x-rbac-action': 'delete' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contacts/search',
    summary: 'Search contacts',
    description: 'Runs advanced contact search with explicit API-key auth and contact:read permission check.',
    tags: [contactTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ContactSearchQuery },
    responses: {
      200: { description: 'Contact search results returned.', schema: ApiSuccess },
      400: { description: 'Invalid search query.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for contact read.', schema: ApiError },
      500: { description: 'Unexpected contact search failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'contact', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contacts/export',
    summary: 'Export contacts',
    description: 'Exports contacts as CSV or JSON using explicit API-key auth and contact:read permission.',
    tags: [contactTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ContactExportQuery },
    responses: {
      200: { description: 'Contact export response. CSV format returns text/csv body; JSON format returns standard API envelope.', schema: ApiSuccess },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for contact read.', schema: ApiError },
      500: { description: 'Unexpected contact export failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'contact', 'x-rbac-action': 'read', 'x-returns-csv-when-format-csv': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contacts/stats',
    summary: 'Get contact stats',
    description: 'Returns contact statistics using explicit API-key auth and contact:read permission.',
    tags: [contactTag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Contact stats returned.', schema: ApiSuccess },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for contact read.', schema: ApiError },
      500: { description: 'Unexpected contact stats failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'contact', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/client-contract-lines',
    summary: 'List client contract lines',
    description:
      'Lists client contract line assignments. Current implementation validates query but returns TODO stub `{ data: [], total: 0 }`. This route requires request context and can fail with `Request context not available` when not wired.',
    tags: [contractTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ClientContractLineQuery },
    responses: {
      200: { description: 'Stubbed empty assignment list returned.', schema: ApiSuccess },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ApiError },
      500: { description: 'Request context missing or unhandled failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
      'x-request-context-wiring-gap': true,
      'x-service-implementation-status': 'todo-stub',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/client-contract-lines',
    summary: 'Assign contract line to client',
    description: 'Assigns one contract line to client using createClientContractLineSchema validation. Requires request context wiring.',
    tags: [contractTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: ClientContractLineBody } },
    responses: {
      201: { description: 'Client contract line assignment created.', schema: ApiSuccess },
      400: { description: 'Invalid request payload.', schema: ApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ApiError },
      500: { description: 'Request context missing or unhandled assignment failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
      'x-request-context-wiring-gap': true,
      'x-id-provenance': { client_contract_line_id: 'contract_lines.contract_line_id (client-owned line model)' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/client-contract-lines/{id}',
    summary: 'Unassign contract line from client',
    description: 'Deactivates the client-owned contract line assignment (current model) for provided id.',
    tags: [contractTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientContractLineIdParam },
    responses: {
      204: { description: 'Client contract line unassigned.', emptyBody: true },
      400: { description: 'Invalid assignment id format.', schema: ApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ApiError },
      500: { description: 'Request context missing or unassignment failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
      'x-request-context-wiring-gap': true,
      'x-returns-json-with-204-currently': true,
    },
    edition: 'both',
  });
}
