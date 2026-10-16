import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerQuotesContractsV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Quotes & Contracts v1';

  const QuoteIdParam = registry.registerSchema(
    'QuoteIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('Quote UUID from quotes.quote_id.') }),
  );

  const QuoteItemParams = registry.registerSchema(
    'QuoteItemParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Quote UUID from quotes.quote_id.'),
      itemId: zOpenApi.string().uuid().describe('Quote item UUID from quote_items.quote_item_id.'),
    }),
  );

  const ContractLineParams = registry.registerSchema(
    'ContractLineParamsV1',
    zOpenApi.object({
      contractId: zOpenApi.string().uuid().describe('Contract UUID from contracts.contract_id.'),
      contractLineId: zOpenApi.string().uuid().describe('Contract line UUID from contract_lines.contract_line_id.'),
    }),
  );

  const ContractIdParam = registry.registerSchema(
    'ContractIdParamV1',
    zOpenApi.object({ contractId: zOpenApi.string().uuid().describe('Contract UUID from contracts.contract_id.') }),
  );

  const ListQuery = registry.registerSchema(
    'QuotesContractsListQueryV1',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      search: zOpenApi.string().optional(),
      status: zOpenApi.string().optional(),
      include_items: zOpenApi.enum(['true', 'false']).optional(),
      include_client: zOpenApi.enum(['true', 'false']).optional(),
    }),
  );

  const GenericBody = registry.registerSchema(
    'QuotesContractsGenericBodyV1',
    zOpenApi.record(zOpenApi.unknown()).describe('Controller/service-specific payload; see quote/contract controller schemas for exact required fields.'),
  );

  const CreateQuoteBody = registry.registerSchema(
    'CreateQuoteBodyV1',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid(),
      title: zOpenApi.string().optional(),
      quote_number: zOpenApi.string().optional(),
      valid_until: zOpenApi.string().optional(),
      notes: zOpenApi.string().optional(),
      terms: zOpenApi.string().optional(),
      items: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
    }),
  );

  const CreateContractBody = registry.registerSchema(
    'CreateContractBodyV1',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().describe('REQUIRED. Owning client (owner_client_id is accepted as an alias). A contract is always client-owned; creating without a client is rejected with 400 so no unassigned, UI-invisible contract can be created.'),
      contract_name: zOpenApi.string().min(1),
      contract_description: zOpenApi.string().optional(),
      billing_frequency: zOpenApi.string().describe('monthly | quarterly | semi-annually | annually.'),
      start_date: zOpenApi.string().describe('YYYY-MM-DD (or ISO datetime). Required: it is the assignment start date.'),
      end_date: zOpenApi.string().nullable().optional(),
      status: zOpenApi.enum(['active', 'draft', 'terminated', 'expired', 'published', 'archived']).optional().describe('Defaults to draft semantics: a draft contract gets an inactive assignment.'),
      is_active: zOpenApi.boolean().optional(),
      billing_profile_id: zOpenApi.string().uuid().nullable().optional(),
      po_required: zOpenApi.boolean().optional(),
      po_number: zOpenApi.string().nullable().optional(),
      po_amount: zOpenApi.number().nullable().optional(),
      lines: zOpenApi.array(zOpenApi.object({
        contract_line_id: zOpenApi.string().uuid(),
        custom_rate: zOpenApi.number().min(0).optional(),
      })).optional().describe('Optional contract lines attached in the same transaction. Any invalid line rolls back the header, the assignment and all lines.'),
    }),
  );

  const UpdateContractBody = registry.registerSchema(
    'UpdateContractBodyV1',
    zOpenApi.object({
      contract_name: zOpenApi.string().min(1).optional(),
      contract_description: zOpenApi.string().nullable().optional(),
      billing_frequency: zOpenApi.string().optional(),
      status: zOpenApi.enum(['active', 'draft', 'terminated', 'expired', 'published', 'archived']).optional(),
      is_active: zOpenApi.boolean().optional(),
    }),
  );

  const AssignmentParams = registry.registerSchema(
    'ContractAssignmentParamsV1',
    zOpenApi.object({
      contractId: zOpenApi.string().uuid().describe('Contract UUID from contracts.contract_id.'),
      clientContractId: zOpenApi.string().uuid().describe('Assignment UUID from client_contracts.client_contract_id.'),
    }),
  );

  const CreateAssignmentBody = registry.registerSchema(
    'CreateContractAssignmentBodyV1',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().optional().describe('Defaults to the contract owner; must equal it when supplied.'),
      start_date: zOpenApi.string(),
      end_date: zOpenApi.string().nullable().optional(),
      is_active: zOpenApi.boolean().optional().describe('Defaults to true only when the contract header is active and not draft.'),
      billing_profile_id: zOpenApi.string().uuid().nullable().optional(),
      po_required: zOpenApi.boolean().optional(),
      po_number: zOpenApi.string().nullable().optional(),
      po_amount: zOpenApi.number().nullable().optional(),
    }),
  );

  const UpdateAssignmentBody = registry.registerSchema(
    'UpdateContractAssignmentBodyV1',
    zOpenApi.object({
      start_date: zOpenApi.string().optional(),
      end_date: zOpenApi.string().nullable().optional(),
      is_active: zOpenApi.boolean().optional().describe('true activates the assignment and its contract header (UI "Set to Active").'),
      billing_profile_id: zOpenApi.string().uuid().nullable().optional(),
      po_required: zOpenApi.boolean().optional(),
      po_number: zOpenApi.string().nullable().optional(),
      po_amount: zOpenApi.number().nullable().optional(),
    }),
  );

  const ApiError = registry.registerSchema(
    'QuotesContractsApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const ApiSuccess = registry.registerSchema(
    'QuotesContractsApiSuccessV1',
    zOpenApi.object({
      data: zOpenApi.union([
        zOpenApi.record(zOpenApi.unknown()),
        zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      ]),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const ApiPaginated = registry.registerSchema(
    'QuotesContractsApiPaginatedV1',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
      }).optional(),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
      _links: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  type Def = {
    method: 'get' | 'post' | 'put' | 'patch' | 'delete';
    path: string;
    summary: string;
    description: string;
    family: 'quote' | 'contract';
  };

  const defs: Def[] = [
    { method: 'get', path: '/api/v1/quotes', summary: 'List quotes', description: 'Lists quotes via ApiQuoteController.list() with authorization-aware filtering.', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes', summary: 'Create quote', description: 'Creates quote via ApiQuoteController.create().', family: 'quote' },
    { method: 'get', path: '/api/v1/quotes/{id}', summary: 'Get quote', description: 'Gets quote UUID via ApiQuoteController.getById().', family: 'quote' },
    { method: 'put', path: '/api/v1/quotes/{id}', summary: 'Update quote', description: 'Updates quote UUID via ApiQuoteController.update().', family: 'quote' },
    { method: 'delete', path: '/api/v1/quotes/{id}', summary: 'Delete quote', description: 'Deletes quote UUID via ApiQuoteController.delete().', family: 'quote' },
    { method: 'get', path: '/api/v1/quotes/{id}/activities', summary: 'List quote activities', description: 'Lists quote activity history via listActivities().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/approve', summary: 'Approve quote', description: 'Approves quote pending-approval state via approve(); includes self-approval guard.', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/convert', summary: 'Convert quote', description: 'Converts quote to downstream entities via convert().', family: 'quote' },
    { method: 'get', path: '/api/v1/quotes/{id}/convert/preview', summary: 'Preview quote conversion', description: 'Returns conversion preview via conversionPreview().', family: 'quote' },
    { method: 'get', path: '/api/v1/quotes/{id}/items', summary: 'List quote items', description: 'Lists quote items via listItems().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/items', summary: 'Add quote item', description: 'Adds quote item via addItem().', family: 'quote' },
    { method: 'put', path: '/api/v1/quotes/{id}/items/{itemId}', summary: 'Update quote item', description: 'Updates quote item via updateItem().', family: 'quote' },
    { method: 'delete', path: '/api/v1/quotes/{id}/items/{itemId}', summary: 'Delete quote item', description: 'Deletes quote item via deleteItem().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/items/reorder', summary: 'Reorder quote items', description: 'Reorders quote item sequence via reorderItems().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/remind', summary: 'Send quote reminder', description: 'Sends reminder for quote via remind().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/request-changes', summary: 'Request quote changes', description: 'Requests changes on pending-approval quote via requestChanges().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/resend', summary: 'Resend quote', description: 'Resends quote via resend().', family: 'quote' },
    { method: 'get', path: '/api/v1/quotes/{id}/revisions', summary: 'List quote revisions', description: 'Lists quote versions via listVersions().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/revisions', summary: 'Create quote revision', description: 'Creates quote revision via createRevision().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/send', summary: 'Send quote', description: 'Sends quote to recipient workflow via send().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/submit-for-approval', summary: 'Submit quote for approval', description: 'Moves quote to pending-approval state via submitForApproval().', family: 'quote' },

    { method: 'get', path: '/api/v1/contracts', summary: 'List contracts', description: 'Lists contracts via ApiContractLineController.listContracts() (v2 controller mounted under v1 route).', family: 'contract' },
    { method: 'post', path: '/api/v1/contracts', summary: 'Create contract', description: 'Creates a client-owned contract the way the UI wizard does: header + client_contracts assignment (+ optional lines) in ONE transaction, so the contract appears in the product. client_id is required (400 otherwise). Responds 201.', family: 'contract' },
    { method: 'get', path: '/api/v1/contracts/{contractId}', summary: 'Get contract', description: 'Gets a contract with its assignments and contract lines.', family: 'contract' },
    { method: 'put', path: '/api/v1/contracts/{contractId}', summary: 'Update contract', description: 'Updates contract header fields with the UI rules (system-managed contracts: 422; invoiced/expired restrictions: 409).', family: 'contract' },
    { method: 'patch', path: '/api/v1/contracts/{contractId}', summary: 'Patch contract', description: 'Alias of PUT (partial header update).', family: 'contract' },
    { method: 'delete', path: '/api/v1/contracts/{contractId}', summary: 'Delete contract', description: 'Deletes a contract with the UI rules: 404 not found, 422 system-managed, 409 has invoices. 204 on success.', family: 'contract' },
    { method: 'get', path: '/api/v1/contracts/{contractId}/assignments', summary: 'List contract assignments', description: 'Lists client_contracts rows for the contract.', family: 'contract' },
    { method: 'post', path: '/api/v1/contracts/{contractId}/assignments', summary: 'Create contract assignment', description: 'Assigns an existing contract to its owning client (e.g. repairs a contract with no client_contracts row). 409 if already assigned, 422 if system-managed or client is not the owner.', family: 'contract' },
    { method: 'get', path: '/api/v1/contracts/{contractId}/assignments/{clientContractId}', summary: 'Get contract assignment', description: 'Gets one assignment.', family: 'contract' },
    { method: 'put', path: '/api/v1/contracts/{contractId}/assignments/{clientContractId}', summary: 'Update contract assignment', description: 'Updates dates/terms; is_active:true activates the assignment and contract.', family: 'contract' },
    { method: 'patch', path: '/api/v1/contracts/{contractId}/assignments/{clientContractId}', summary: 'Patch contract assignment', description: 'Alias of PUT.', family: 'contract' },
    { method: 'delete', path: '/api/v1/contracts/{contractId}/assignments/{clientContractId}', summary: 'Delete contract assignment', description: 'Removes an assignment unless invoices reference it (409; end it with an update instead). 204 on success.', family: 'contract' },
    { method: 'post', path: '/api/v1/contracts/{contractId}/contract-lines', summary: 'Attach contract line', description: 'Attaches contract line to contract via addContractLine() using body contract_line_id/custom_rate.', family: 'contract' },
    { method: 'delete', path: '/api/v1/contracts/{contractId}/contract-lines/{contractLineId}', summary: 'Detach contract line', description: 'Detaches contract line from contract via removeContractLine().', family: 'contract' },
  ];

  function requestFor(def: Def) {
    const req: Record<string, unknown> = {};

    if (def.path.includes('/quotes/{id}/items/{itemId}')) req.params = QuoteItemParams;
    if (def.path.includes('/quotes/{id}')) req.params = QuoteIdParam;
    if (def.path.includes('/contracts/{contractId}/contract-lines/{contractLineId}')) req.params = ContractLineParams;
    else if (def.path.includes('/contracts/{contractId}/assignments/{clientContractId}')) req.params = AssignmentParams;
    else if (def.path.includes('/contracts/{contractId}')) req.params = ContractIdParam;

    if (def.path === '/api/v1/quotes' || def.path === '/api/v1/contracts') req.query = ListQuery;

    if (def.path === '/api/v1/quotes' && def.method === 'post') req.body = { schema: CreateQuoteBody };
    if (def.path.startsWith('/api/v1/quotes/') && ['post', 'put'].includes(def.method)) req.body = { schema: GenericBody };

    if (def.path === '/api/v1/contracts' && def.method === 'post') req.body = { schema: CreateContractBody };
    if (def.path === '/api/v1/contracts/{contractId}' && ['put', 'patch'].includes(def.method)) req.body = { schema: UpdateContractBody };
    if (def.path === '/api/v1/contracts/{contractId}/assignments' && def.method === 'post') req.body = { schema: CreateAssignmentBody };
    if (def.path === '/api/v1/contracts/{contractId}/assignments/{clientContractId}' && ['put', 'patch'].includes(def.method)) req.body = { schema: UpdateAssignmentBody };
    if (def.path === '/api/v1/contracts/{contractId}/contract-lines') {
      req.body = {
        schema: zOpenApi.object({
          contract_line_id: zOpenApi.string().uuid(),
          custom_rate: zOpenApi.number().optional(),
        }),
      };
    }

    return req;
  }

  function responsesFor(def: Def) {
    const responses: Record<number, any> = {
      400: { description: 'Validation or request parsing failure.', schema: ApiError },
      401: { description: 'API key missing/invalid or associated user missing.', schema: ApiError },
      403: { description: `RBAC denied for ${def.family} resource action.`, schema: ApiError },
      500: { description: 'Unexpected controller/service failure.', schema: ApiError },
    };

    if (def.path === '/api/v1/quotes' && def.method === 'get') {
      responses[200] = { description: 'Paginated quotes returned.', schema: ApiPaginated };
      return responses;
    }
    if (def.path === '/api/v1/contracts' && def.method === 'get') {
      responses[200] = { description: 'Paginated contracts returned.', schema: ApiPaginated };
      return responses;
    }

    responses[200] = { description: 'Operation succeeded.', schema: ApiSuccess };

    if (def.family === 'contract' && (def.method === 'put' || def.method === 'patch' || def.method === 'delete' || def.method === 'post')) {
      responses[409] = { description: 'Conflicts with current state (invoices exist, already assigned, mixed currency).', schema: ApiError };
      responses[422] = { description: 'Refused by business rule (system-managed contract).', schema: ApiError };
    }

    if (def.method === 'post') responses[201] = { description: 'Create-like operation succeeded.', schema: ApiSuccess };
    if (def.method === 'delete') responses[204] = { description: 'Delete-like operation can return no content.', emptyBody: true };
    if (def.path.includes('{id}') || def.path.includes('{itemId}') || def.path.includes('{contractId}') || def.path.includes('{contractLineId}')) {
      responses[404] = { description: 'Target record not found.', schema: ApiError };
    }

    return responses;
  }

  for (const def of defs) {
    const extensions: Record<string, unknown> = {
      'x-tenant-scoped': true,
      'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate() or route middleware before handler',
      'x-tenant-header': 'x-tenant-id (optional; inferred from API key when omitted)',
      'x-rbac-resource': def.family === 'quote' ? 'quote' : 'contract_line',
    };

    if (def.family === 'quote') {
      extensions['x-read-authorization-resource'] = 'billing';
    }

    if (def.family === 'contract') {
      extensions['x-controller-origin'] = 'ApiContractLineController (v2) mounted under v1 routes';
      extensions['x-request-context-wiring-gap'] = 'Controller requires req.context via requireRequestContext(req); v1 route lacks explicit withApiKeyAuth wrapper.';
    }

    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: def.summary,
      description: def.description,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      request: requestFor(def),
      responses: responsesFor(def),
      extensions,
      edition: 'both',
    });
  }
}
