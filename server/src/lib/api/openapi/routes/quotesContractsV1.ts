import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import { CONTRACT_START_DATE_DESCRIPTION, CONTRACT_END_DATE_DESCRIPTION } from '../../schemas/contractLineSchemas';

export function registerQuotesContractsV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Quotes & Contracts v1';

  const QuoteIdParam = registry.registerSchema(
    'QuoteIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().guid().describe('Quote UUID from quotes.quote_id.') }),
  );

  const QuoteItemParams = registry.registerSchema(
    'QuoteItemParamsV1',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Quote UUID from quotes.quote_id.'),
      itemId: zOpenApi.string().guid().describe('Quote item UUID from quote_items.quote_item_id.'),
    }),
  );

  const ContractLineParams = registry.registerSchema(
    'ContractLineParamsV1',
    zOpenApi.object({
      contractId: zOpenApi.string().guid().describe('Contract UUID from contracts.contract_id.'),
      contractLineId: zOpenApi.string().guid().describe('Contract line UUID from contract_lines.contract_line_id.'),
    }),
  );

  const ContractIdParam = registry.registerSchema(
    'ContractIdParamV1',
    zOpenApi.object({ contractId: zOpenApi.string().guid().describe('Contract UUID from contracts.contract_id.') }),
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
    zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).describe('Controller/service-specific payload; see quote/contract controller schemas for exact required fields.'),
  );

  const QUOTE_DATE_DESCRIPTION = 'Calendar date as YYYY-MM-DD.';
  const UNIT_PRICE_DESCRIPTION =
    'Integer price in minor units (cents), >= 0. A fixed discount is NOT a negative price: send a positive unit_price with is_discount: true and discount_type: "fixed", optionally naming the line it reduces via applies_to_item_id.';

  const QuoteItemBody = registry.registerSchema(
    'QuoteItemBodyV1',
    zOpenApi.object({
      service_id: zOpenApi.string().guid().nullable().optional().describe('Catalog service to snapshot name, SKU, unit, cost and tax treatment from. Omit for a custom or discount line.'),
      description: zOpenApi.string().min(1).max(1000).describe('Line description shown on the quote.'),
      quantity: zOpenApi.number().int().min(1).describe('Integer quantity, >= 1.'),
      unit_price: zOpenApi.number().int().min(0).describe(UNIT_PRICE_DESCRIPTION),
      unit_of_measure: zOpenApi.string().max(100).nullable().optional().describe('Human-readable unit label, e.g. "hours".'),
      unit_code: zOpenApi.string().nullable().optional().describe('UN/CEFACT REC 20 unit code, e.g. C62 (each) or HUR (hour). Resolved from unit_of_measure when omitted.'),
      phase: zOpenApi.string().max(255).nullable().optional().describe('Free-text grouping label for the line.'),
      location_id: zOpenApi.string().guid().nullable().optional().describe('client_locations.location_id the line is delivered to. Must belong to the quote\'s client, otherwise the request is rejected with 400.'),
      cost: zOpenApi.number().int().min(0).nullable().optional().describe('Integer cost in minor units, used for margin display. Snapshotted from the catalog for product lines.'),
      cost_currency: zOpenApi.string().length(3).nullable().optional().describe('ISO 4217 code for cost.'),
      is_optional: zOpenApi.boolean().optional().describe('Marks the line as optional on the quote. Defaults to false.'),
      is_selected: zOpenApi.boolean().nullable().optional().describe('Whether an optional line is selected. Defaults to true.'),
      is_recurring: zOpenApi.boolean().optional().describe('Recurring (contract) line rather than one-time. Defaults to false.'),
      billing_frequency: zOpenApi.string().max(50).nullable().optional().describe('Required by the editor for recurring lines, e.g. "monthly".'),
      billing_method: zOpenApi.string().max(50).nullable().optional().describe('Billing method, e.g. fixed or per_unit. Falls back to the service default.'),
      is_discount: zOpenApi.boolean().optional().describe('Marks the line as a discount. Defaults to false.'),
      discount_type: zOpenApi.enum(['percentage', 'fixed']).nullable().optional().describe('With is_discount: "percentage" uses discount_percentage, "fixed" uses the positive unit_price.'),
      discount_percentage: zOpenApi.number().min(0).max(100).nullable().optional().describe('Percentage discount, 0-100.'),
      applies_to_item_id: zOpenApi.string().guid().nullable().optional().describe('Restricts a discount to one quote item; omit to spread it across the quote.'),
      applies_to_service_id: zOpenApi.string().guid().nullable().optional().describe('Restricts a discount to lines of one service.'),
      is_taxable: zOpenApi.boolean().optional().describe('Omit to derive the treatment from the service tax configuration; an explicit value overrides it.'),
      tax_region: zOpenApi.string().max(100).nullable().optional().describe('Tax region override for the line.'),
      tax_rate: zOpenApi.number().min(0).nullable().optional().describe('Tax rate percentage override; fractional values are kept as sent.'),
      service_name: zOpenApi.string().max(255).nullable().optional().describe('Overrides the snapshotted catalog service name.'),
      service_sku: zOpenApi.string().max(100).nullable().optional().describe('Overrides the snapshotted catalog SKU.'),
      service_item_kind: zOpenApi.string().max(50).nullable().optional().describe('Item kind, e.g. product or service. Falls back to the catalog value.'),
    }).describe('Quote item body for POST /quotes/{id}/items. PUT /quotes/{id}/items/{itemId} takes any subset of the same fields. catalog_description is a server-captured snapshot and is ignored if sent.'),
  );

  const QuoteBodyFields = {
    client_id: zOpenApi.string().guid().nullable().optional().describe('Owning client. Required before the quote can be converted, and required when any item carries a location_id.'),
    contact_id: zOpenApi.string().guid().nullable().optional().describe('Primary contact at the client.'),
    description: zOpenApi.string().nullable().optional().describe('Internal summary of the quote.'),
    quote_date: zOpenApi.string().nullable().optional().describe(`Quote issue date. ${QUOTE_DATE_DESCRIPTION}`),
    valid_until: zOpenApi.string().nullable().optional().describe(`Expiry date. ${QUOTE_DATE_DESCRIPTION}`),
    po_number: zOpenApi.string().max(255).nullable().optional().describe('Client purchase-order number.'),
    recurring_section_title: zOpenApi.string().max(255).nullable().optional().describe('Heading for the recurring section on the rendered quote.'),
    onetime_section_title: zOpenApi.string().max(255).nullable().optional().describe('Heading for the one-time section on the rendered quote.'),
    opportunity_id: zOpenApi.string().guid().nullable().optional().describe('Opportunity this quote belongs to.'),
    internal_notes: zOpenApi.string().nullable().optional().describe('Notes kept internal to the MSP. This is the real field name; the published `notes` alias is deprecated.'),
    client_notes: zOpenApi.string().nullable().optional().describe('Notes shown to the client on the quote.'),
    terms_and_conditions: zOpenApi.string().nullable().optional().describe('Terms text rendered on the quote. This is the real field name; the published `terms` alias is deprecated.'),
    currency_code: zOpenApi.string().length(3).optional().describe('ISO 4217 code. Resolved from the client default, then the tenant billing default, when omitted.'),
    tax_source: zOpenApi.enum(['internal', 'external', 'pending_external']).optional().describe('Where tax figures come from. Defaults to internal.'),
    is_template: zOpenApi.boolean().optional().describe('Creates a reusable template instead of a live quote. Defaults to false.'),
    template_id: zOpenApi.string().guid().nullable().optional().describe('Template this quote was created from.'),
  };

  const CreateQuoteBody = registry.registerSchema(
    'CreateQuoteBodyV1',
    zOpenApi.object({
      title: zOpenApi.string().min(1).max(500).describe('Quote title. The only required field.'),
      ...QuoteBodyFields,
      items: zOpenApi.array(QuoteItemBody).optional().describe('Line items created with the quote, in order.'),
      notes: zOpenApi.string().nullable().optional().describe('DEPRECATED alias for internal_notes, honoured for one release. Previously documented here but never persisted.'),
      terms: zOpenApi.string().nullable().optional().describe('DEPRECATED alias for terms_and_conditions, honoured for one release. Previously documented here but never persisted.'),
      quote_number: zOpenApi.string().nullable().optional().describe('DEPRECATED and ignored: quote numbers are assigned by the server.'),
    }).describe('Create body for POST /api/v1/quotes. Unknown keys other than the deprecated aliases are rejected with 400 rather than silently dropped.'),
  );

  const UpdateQuoteBody = registry.registerSchema(
    'UpdateQuoteBodyV1',
    zOpenApi.object({
      title: zOpenApi.string().min(1).max(500).optional().describe('Quote title.'),
      ...QuoteBodyFields,
      status: zOpenApi.enum([
        'draft', 'pending_approval', 'approved', 'sent', 'accepted',
        'rejected', 'expired', 'converted', 'cancelled', 'superseded', 'archived',
      ]).nullable().optional().describe('Status transition, validated against the quote status machine. Prefer the dedicated command routes (submit-for-approval, approve, send, archive); direct status writes are being withdrawn.'),
    }).describe('Update body for PUT /api/v1/quotes/{id}. Every field is optional and absent keys are left untouched. Items are not updatable here: use the /quotes/{id}/items endpoints.'),
  );

  const CreateContractBody = registry.registerSchema(
    'CreateContractBodyV1',
    zOpenApi.object({
      client_id: zOpenApi.string().guid(),
      contract_name: zOpenApi.string().optional(),
      start_date: zOpenApi.string().optional(),
      end_date: zOpenApi.string().optional(),
      billing_frequency: zOpenApi.string().optional(),
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
        zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()),
        zOpenApi.array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown())),
      ]),
      meta: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );

  const ApiPaginated = registry.registerSchema(
    'QuotesContractsApiPaginatedV1',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown())),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
      }).optional(),
      meta: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
      _links: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );

  const ContractListItem = registry.registerSchema(
    'ContractListItemV1',
    zOpenApi.object({
      contract_id: zOpenApi.string().guid(),
      contract_name: zOpenApi.string(),
      start_date: zOpenApi.string().datetime().nullable().optional().describe(CONTRACT_START_DATE_DESCRIPTION),
      end_date: zOpenApi.string().datetime().nullable().optional().describe(CONTRACT_END_DATE_DESCRIPTION),
      total_plans: zOpenApi.number().int().optional().describe('Count of contract lines on the contract.'),
      clients_using_contract: zOpenApi.number().int().optional().describe('Count of distinct clients assigned the contract.'),
    }).passthrough().describe('Contract header as returned by the list endpoint; see contractResponseSchema for the full field set.'),
  );

  const ApiPaginatedContracts = registry.registerSchema(
    'ContractsApiPaginatedV1',
    zOpenApi.object({
      data: zOpenApi.array(ContractListItem),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
      }).optional(),
      meta: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
      _links: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );

  type Def = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    summary: string;
    description: string;
    family: 'quote' | 'contract';
  };

  const defs: Def[] = [
    { method: 'get', path: '/api/v1/quotes', summary: 'List quotes', description: 'Lists quotes via ApiQuoteController.list() with authorization-aware filtering.', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes', summary: 'Create quote', description: 'Creates quote via ApiQuoteController.create(). Notes and terms are internal_notes and terms_and_conditions; the previously documented notes/terms aliases still map onto them for one release, quote_number is server-assigned and ignored, and any other unknown key is rejected with 400.', family: 'quote' },
    { method: 'get', path: '/api/v1/quotes/{id}', summary: 'Get quote', description: 'Gets quote UUID via ApiQuoteController.getById().', family: 'quote' },
    { method: 'put', path: '/api/v1/quotes/{id}', summary: 'Update quote', description: 'Updates quote UUID via ApiQuoteController.update().', family: 'quote' },
    { method: 'delete', path: '/api/v1/quotes/{id}', summary: 'Delete quote', description: 'Deletes quote UUID via ApiQuoteController.delete().', family: 'quote' },
    { method: 'get', path: '/api/v1/quotes/{id}/activities', summary: 'List quote activities', description: 'Lists quote activity history via listActivities().', family: 'quote' },
    { method: 'post', path: '/api/v1/quotes/{id}/archive', summary: 'Archive quote', description: 'Archives a quote via archive(): allowed from draft, cancelled, rejected and expired; sets status archived plus archived_at and writes a status_changed activity. Any other source status returns 409. This is the Archive alternative offered when DELETE is refused with DEPENDENCIES_EXIST.', family: 'quote' },
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
    { method: 'post', path: '/api/v1/contracts', summary: 'Create contract', description: 'Creates contract via ApiContractLineController.createContract() (v2 controller mounted under v1 route).', family: 'contract' },
    { method: 'post', path: '/api/v1/contracts/{contractId}/contract-lines', summary: 'Attach contract line', description: 'Attaches contract line to contract via addContractLine() using body contract_line_id/custom_rate.', family: 'contract' },
    { method: 'delete', path: '/api/v1/contracts/{contractId}/contract-lines/{contractLineId}', summary: 'Detach contract line', description: 'Detaches contract line from contract via removeContractLine().', family: 'contract' },
  ];

  function requestFor(def: Def) {
    const req: Record<string, unknown> = {};

    if (def.path.includes('/quotes/{id}/items/{itemId}')) req.params = QuoteItemParams;
    if (def.path.includes('/quotes/{id}')) req.params = QuoteIdParam;
    if (def.path.includes('/contracts/{contractId}/contract-lines/{contractLineId}')) req.params = ContractLineParams;
    if (def.path.includes('/contracts/{contractId}/contract-lines')) req.params = ContractIdParam;

    if (def.path === '/api/v1/quotes' || def.path === '/api/v1/contracts') req.query = ListQuery;

    if (def.path === '/api/v1/quotes' && def.method === 'post') req.body = { schema: CreateQuoteBody };
    if (def.path.startsWith('/api/v1/quotes/') && ['post', 'put'].includes(def.method)) req.body = { schema: GenericBody };
    if (def.path === '/api/v1/quotes/{id}' && def.method === 'put') req.body = { schema: UpdateQuoteBody };
    if (def.path === '/api/v1/quotes/{id}/items' && def.method === 'post') req.body = { schema: QuoteItemBody };
    if (def.path === '/api/v1/quotes/{id}/items/{itemId}' && def.method === 'put') req.body = { schema: QuoteItemBody };
    // Command with no body; anything sent is ignored.
    if (def.path === '/api/v1/quotes/{id}/archive') delete req.body;

    if (def.path === '/api/v1/contracts' && def.method === 'post') req.body = { schema: CreateContractBody };
    if (def.path === '/api/v1/contracts/{contractId}/contract-lines') {
      req.body = {
        schema: zOpenApi.object({
          contract_line_id: zOpenApi.string().guid(),
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
      responses[200] = { description: 'Paginated contracts returned.', schema: ApiPaginatedContracts };
      return responses;
    }

    responses[200] = { description: 'Operation succeeded.', schema: ApiSuccess };

    if (def.method === 'post') responses[201] = { description: 'Create-like operation succeeded.', schema: ApiSuccess };
    if (def.method === 'delete') responses[204] = { description: 'Delete-like operation can return no content.', emptyBody: true };

    if (def.path === '/api/v1/quotes/{id}/archive') {
      responses[409] = {
        description: 'Quote status does not allow archiving; only draft, cancelled, rejected and expired quotes can be archived.',
        schema: ApiError,
      };
    }
    if (def.path === '/api/v1/quotes/{id}' && def.method === 'delete') {
      responses[409] = {
        description: 'DEPENDENCIES_EXIST: blocking records remain. error.details.dependencies names each blocking record type with its count, and error.details.alternatives offers Archive (POST /api/v1/quotes/{id}/archive).',
        schema: ApiError,
      };
    }
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
