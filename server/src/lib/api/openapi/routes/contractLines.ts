import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerContractLineRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Contract Lines';

  const PlanType = zOpenApi.enum(['Fixed', 'Hourly', 'Usage']);
  const BillingFrequency = zOpenApi.enum(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']);
  const ConfigurationType = zOpenApi.enum(['Fixed', 'Hourly', 'Usage', 'Bucket']);

  const ContractLineIdParam = registry.registerSchema(
    'ContractLineIdParam',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Contract line UUID from contract_lines.contract_line_id.'),
    }),
  );

  const ContractLineServiceParam = registry.registerSchema(
    'ContractLineServiceParam',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Contract line UUID from contract_lines.contract_line_id.'),
      serviceId: zOpenApi.string().uuid().describe('Service UUID from service_catalog.service_id.'),
    }),
  );

  const ContractLineTemplateParam = registry.registerSchema(
    'ContractLineTemplateParam',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Template UUID from plan_templates.template_id.'),
    }),
  );

  const ContractLineListQuery = registry.registerSchema(
    'ContractLineListQuery',
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
      contract_line_name: zOpenApi.string().optional(),
      contract_line_type: PlanType.optional(),
      billing_frequency: BillingFrequency.optional(),
      is_custom: zOpenApi.enum(['true', 'false']).optional(),
      is_active: zOpenApi.enum(['true', 'false']).optional(),
      service_category: zOpenApi.string().optional(),
      has_services: zOpenApi.enum(['true', 'false']).optional(),
      clients_count_min: zOpenApi.string().optional(),
      clients_count_max: zOpenApi.string().optional(),
      revenue_min: zOpenApi.string().optional(),
      revenue_max: zOpenApi.string().optional(),
      include_services: zOpenApi.enum(['true', 'false']).optional().describe('Controller-level include flag parsed directly from query string.'),
      include_usage: zOpenApi.enum(['true', 'false']).optional().describe('Controller-level include flag parsed directly from query string.'),
      include_clients: zOpenApi.enum(['true', 'false']).optional().describe('Controller-level include flag parsed directly from query string.'),
    }),
  );

  const UsageMetricsQuery = registry.registerSchema(
    'ContractLineUsageMetricsQuery',
    zOpenApi.object({
      period_start: zOpenApi.string().datetime().optional().describe('Defaults to now minus 30 days when omitted.'),
      period_end: zOpenApi.string().datetime().optional().describe('Defaults to now when omitted.'),
    }),
  );

  const ContractLineBody = registry.registerSchema(
    'ContractLineBody',
    zOpenApi.object({
      contract_line_name: zOpenApi.string().min(1).max(255),
      billing_frequency: BillingFrequency,
      is_custom: zOpenApi.boolean().optional(),
      service_category: zOpenApi.string().optional(),
      contract_line_type: PlanType,
      cadence_owner: zOpenApi.enum(['client', 'contract']).optional(),
      hourly_rate: zOpenApi.number().min(0).optional(),
      minimum_billable_time: zOpenApi.number().min(0).optional(),
      round_up_to_nearest: zOpenApi.number().min(1).optional(),
      enable_overtime: zOpenApi.boolean().optional(),
      overtime_rate: zOpenApi.number().min(0).optional(),
      overtime_threshold: zOpenApi.number().min(0).optional(),
      enable_after_hours_rate: zOpenApi.boolean().optional(),
      after_hours_multiplier: zOpenApi.number().min(0).optional(),
      is_active: zOpenApi.boolean().optional(),
      features: zOpenApi.array(zOpenApi.string()).optional(),
      location_id: zOpenApi.string().uuid().nullable().optional(),
    }),
  );

  const UpdateContractLineBody = registry.registerSchema('UpdateContractLineBody', ContractLineBody.partial());

  const FixedConfigBody = registry.registerSchema(
    'ContractLineFixedConfigBody',
    zOpenApi.object({
      base_rate: zOpenApi.number().min(0).optional(),
      enable_proration: zOpenApi.boolean().optional(),
      billing_cycle_alignment: zOpenApi.enum(['start', 'end', 'prorated']).optional(),
    }),
  );

  const AddServiceBody = registry.registerSchema(
    'ContractLineAddServiceBody',
    zOpenApi.object({
      service_id: zOpenApi.string().uuid(),
      quantity: zOpenApi.number().min(1).optional(),
      custom_rate: zOpenApi.number().min(0).optional(),
      configuration_type: ConfigurationType.optional(),
      type_config: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const UpdateServiceBody = registry.registerSchema(
    'ContractLineUpdateServiceBody',
    zOpenApi.object({
      quantity: zOpenApi.number().min(1).optional(),
      custom_rate: zOpenApi.number().min(0).optional(),
      type_config: zOpenApi.record(zOpenApi.unknown()).optional(),
      rate_tiers: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
      user_type_rates: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
    }),
  );

  const ActivationBody = registry.registerSchema(
    'ContractLineActivationBody',
    zOpenApi.object({
      is_active: zOpenApi.boolean(),
      effective_date: zOpenApi.string().datetime().optional(),
      reason: zOpenApi.string().optional(),
      notify_clients: zOpenApi.boolean().optional(),
    }),
  );

  const CopyContractLineBody = registry.registerSchema(
    'CopyContractLineBody',
    zOpenApi.object({
      source_contract_line_id: zOpenApi.string().uuid().describe('Used by service; path id is currently ignored.'),
      new_contract_line_name: zOpenApi.string().min(1).max(255),
      copy_services: zOpenApi.boolean().optional(),
      copy_configurations: zOpenApi.boolean().optional(),
      modify_rates: zOpenApi
        .object({
          percentage_change: zOpenApi.number().optional(),
          fixed_adjustment: zOpenApi.number().optional(),
        })
        .optional(),
    }),
  );

  const BulkCreateContractLinesBody = registry.registerSchema(
    'BulkCreateContractLinesBody',
    zOpenApi.object({
      plans: zOpenApi.array(ContractLineBody).min(1).max(50),
    }),
  );

  const BulkUpdateContractLinesBody = registry.registerSchema(
    'BulkUpdateContractLinesBody',
    zOpenApi.object({
      plans: zOpenApi
        .array(
          zOpenApi.object({
            contract_line_id: zOpenApi.string().uuid(),
            data: UpdateContractLineBody,
          }),
        )
        .min(1)
        .max(50),
    }),
  );

  const BulkDeleteContractLinesBody = registry.registerSchema(
    'BulkDeleteContractLinesBody',
    zOpenApi.object({
      contract_line_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(50),
    }),
  );

  const BulkAddServicesBody = registry.registerSchema(
    'BulkAddServicesBody',
    zOpenApi.object({
      contract_line_id: zOpenApi.string().uuid(),
      services: zOpenApi.array(AddServiceBody).min(1).max(20),
    }),
  );

  const BulkRemoveServicesBody = registry.registerSchema(
    'BulkRemoveServicesBody',
    zOpenApi.object({
      contract_line_id: zOpenApi.string().uuid(),
      service_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(20),
    }),
  );

  const CreateTemplateBody = registry.registerSchema(
    'CreateContractLineTemplateBody',
    zOpenApi.object({
      template_name: zOpenApi.string().min(1).max(255),
      template_description: zOpenApi.string().optional(),
      contract_line_type: PlanType,
      billing_frequency: BillingFrequency,
      default_services: zOpenApi
        .array(
          zOpenApi.object({
            service_id: zOpenApi.string().uuid(),
            configuration_type: ConfigurationType,
            default_rate: zOpenApi.number().min(0).optional(),
            quantity: zOpenApi.number().min(1).optional(),
          }),
        )
        .optional(),
      is_public: zOpenApi.boolean().optional(),
    }),
  );

  const CreateFromTemplateBody = registry.registerSchema(
    'CreateContractLineFromTemplateBody',
    zOpenApi.object({
      template_id: zOpenApi.string().uuid().describe('Used by service; current controller ignores the path id and relies on this field.'),
      contract_line_name: zOpenApi.string().min(1).max(255),
      modify_rates: zOpenApi
        .object({
          percentage_change: zOpenApi.number().optional(),
          fixed_adjustment: zOpenApi.number().optional(),
        })
        .optional(),
      override_services: zOpenApi
        .array(
          zOpenApi.object({
            service_id: zOpenApi.string().uuid(),
            custom_rate: zOpenApi.number().min(0).optional(),
            quantity: zOpenApi.number().min(1).optional(),
          }),
        )
        .optional(),
    }),
  );

  const ContractLineApiSuccess = registry.registerSchema(
    'ContractLineApiSuccess',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: zOpenApi.union([
        zOpenApi.record(zOpenApi.unknown()),
        zOpenApi.array(zOpenApi.record(zOpenApi.unknown())),
      ]),
      meta: zOpenApi
        .object({
          timestamp: zOpenApi.string().datetime(),
          version: zOpenApi.string(),
        })
        .passthrough()
        .optional(),
    }),
  );

  const ContractLineApiError = registry.registerSchema(
    'ContractLineApiError',
    zOpenApi.object({
      success: zOpenApi.literal(false),
      error: zOpenApi.object({
        message: zOpenApi.string(),
        code: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
      meta: zOpenApi
        .object({
          timestamp: zOpenApi.string().datetime(),
          version: zOpenApi.string(),
        })
        .optional(),
    }),
  );

  const commonExtensions = {
    'x-tenant-scoped': true,
    'x-auth-source': 'middleware API-key presence + request context requirement in controller',
    'x-request-context-required': true,
    'x-request-context-wiring-gap': true,
  };

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contract-lines',
    summary: 'List contract lines',
    description:
      'Lists contract lines with pagination/filtering and optional include flags. Route requires x-api-key at middleware and a request context in-controller (requireRequestContext). Query parsing/validation uses contractLineListQuerySchema, then listWithOptions reads from contract_lines for the tenant context.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ContractLineListQuery },
    responses: {
      200: { description: 'Contract lines returned.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid query parameters.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contract-lines',
    summary: 'Create contract line',
    description:
      'Creates a contract line row in contract_lines. Validation uses createContractLineSchema (including overtime/after-hours constraints). ID is generated by service with uuidv4. Route currently relies on request context presence and can fail when context is unavailable.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: ContractLineBody } },
    responses: {
      201: { description: 'Contract line created.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-id-provenance': { contract_line_id: 'contract_lines.contract_line_id (uuidv4)' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contract-lines/{id}',
    summary: 'Get contract line',
    description: 'Returns one contract line by contract_line_id, including optional related data through include query flags.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam },
    responses: {
      200: { description: 'Contract line returned.', schema: ContractLineApiSuccess },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      404: { description: 'Contract line not found.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/contract-lines/{id}',
    summary: 'Update contract line',
    description: 'Updates a contract line by contract_line_id using updateContractLineSchema validation.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam, body: { schema: UpdateContractLineBody } },
    responses: {
      200: { description: 'Contract line updated.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/contract-lines/{id}',
    summary: 'Delete contract line',
    description: 'Deletes a contract line after dependency checks (in-use checks, service cleanup, contract detach).',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam },
    responses: {
      204: { description: 'Deletion processed.', emptyBody: true },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or delete blocked by dependency rules.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-returns-json-with-204-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contract-lines/bulk',
    summary: 'Bulk create contract lines',
    description: 'Alias route to bulkCreateContractLines; creates multiple contract lines from `plans` array.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkCreateContractLinesBody } },
    responses: {
      201: { description: 'Bulk create completed.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/contract-lines/bulk',
    summary: 'Bulk update contract lines',
    description: 'Alias route to bulkUpdateContractLines; updates multiple rows by contract_line_id.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkUpdateContractLinesBody } },
    responses: {
      200: { description: 'Bulk update completed.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/contract-lines/bulk',
    summary: 'Bulk delete contract lines',
    description: 'Alias route to bulkDeleteContractLines; deletes multiple contract lines by ID list.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkDeleteContractLinesBody } },
    responses: {
      200: { description: 'Bulk delete completed.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or delete blocked by dependency rules.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contract-lines/bulk/create',
    summary: 'Bulk create contract lines (explicit route)',
    description: 'Same controller behavior as POST /api/v1/contract-lines/bulk.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkCreateContractLinesBody } },
    responses: {
      201: { description: 'Bulk create completed.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/contract-lines/bulk/update',
    summary: 'Bulk update contract lines (explicit route)',
    description: 'Same controller behavior as PUT /api/v1/contract-lines/bulk.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkUpdateContractLinesBody } },
    responses: {
      200: { description: 'Bulk update completed.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/contract-lines/bulk/delete',
    summary: 'Bulk delete contract lines (explicit route)',
    description: 'Same controller behavior as DELETE /api/v1/contract-lines/bulk.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkDeleteContractLinesBody } },
    responses: {
      200: { description: 'Bulk delete completed.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or delete blocked by dependency rules.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contract-lines/bulk/add-services',
    summary: 'Bulk add services to contract line',
    description: 'Adds multiple services to one contract_line_id and returns per-service success/failure results.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkAddServicesBody } },
    responses: {
      200: { description: 'Bulk service add completed.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-partial-failures-in-response': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/contract-lines/bulk/remove-services',
    summary: 'Bulk remove services from contract line',
    description: 'Removes multiple services from one contract_line_id and returns per-service success/failure results.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkRemoveServicesBody } },
    responses: {
      200: { description: 'Bulk service removal completed.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or unhandled service failure.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-partial-failures-in-response': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/contract-lines/{id}/activation',
    summary: 'Set contract line activation',
    description: 'Activates or deactivates a contract line. Deactivation can require a reason when plan is in use.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam, body: { schema: ActivationBody } },
    responses: {
      200: { description: 'Activation state updated.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or activation business-rule failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contract-lines/{id}/analytics',
    summary: 'Get contract line analytics',
    description: 'Returns analytics aggregates for one contract line.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam },
    responses: {
      200: { description: 'Analytics payload returned.', schema: ContractLineApiSuccess },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or analytics query failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contract-lines/{id}/copy',
    summary: 'Copy contract line',
    description:
      'Copies an existing contract line. Current implementation validates and uses `source_contract_line_id` from body, while path `{id}` is not consumed by service logic.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam, body: { schema: CopyContractLineBody } },
    responses: {
      201: { description: 'Contract line copy created.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or copy operation failure.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-path-id-ignored-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contract-lines/{id}/fixed-config',
    summary: 'Get fixed contract line config',
    description: 'Returns fixed-plan configuration for a contract line; returns 404 when not found.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam },
    responses: {
      200: { description: 'Fixed config returned.', schema: ContractLineApiSuccess },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      404: { description: 'Fixed configuration not found.', schema: ContractLineApiError },
      500: { description: 'Request context missing or service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/contract-lines/{id}/fixed-config',
    summary: 'Upsert fixed contract line config',
    description: 'Creates or updates fixed-plan configuration for a contract line.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam, body: { schema: FixedConfigBody } },
    responses: {
      200: { description: 'Fixed config upserted.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contract-lines/{id}/services',
    summary: 'List contract line services',
    description: 'Returns all service configurations linked to a contract line.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam },
    responses: {
      200: { description: 'Service configurations returned.', schema: ContractLineApiSuccess },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contract-lines/{id}/services',
    summary: 'Add service to contract line',
    description: 'Adds one service configuration to a contract line; rejects duplicates.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam, body: { schema: AddServiceBody } },
    responses: {
      201: { description: 'Service added to contract line.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or service-level validation failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contract-lines/{id}/services/{serviceId}',
    summary: 'Get contract line service details',
    description:
      'Route inventory advertises item lookup, but current route handler delegates to getContractLineServices and returns the full service list for `{id}`; `{serviceId}` is effectively ignored in the GET path.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineServiceParam },
    responses: {
      200: { description: 'Current implementation returns full service list for the contract line.', schema: ContractLineApiSuccess },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or service failure.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-service-id-ignored-by-get-handler': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/contract-lines/{id}/services/{serviceId}',
    summary: 'Update contract line service',
    description: 'Updates service configuration for one `{id}` + `{serviceId}` pair.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineServiceParam, body: { schema: UpdateServiceBody } },
    responses: {
      200: { description: 'Service configuration updated.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or service failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/contract-lines/{id}/services/{serviceId}',
    summary: 'Remove service from contract line',
    description: 'Removes one service configuration from a contract line.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineServiceParam },
    responses: {
      204: { description: 'Service removed.', emptyBody: true },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or service removal failure.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-returns-json-with-204-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/contract-lines/{id}/usage-metrics',
    summary: 'Get contract line usage metrics',
    description: 'Returns usage and cost metrics for a contract line over a time window.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineIdParam, query: UsageMetricsQuery },
    responses: {
      200: { description: 'Usage metrics returned.', schema: ContractLineApiSuccess },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or usage query failure.', schema: ContractLineApiError },
    },
    extensions: commonExtensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contract-line-templates',
    summary: 'Create contract line template',
    description: 'Creates a plan template record under plan_templates with optional default services.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CreateTemplateBody } },
    responses: {
      201: { description: 'Template created.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or template creation failure.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-id-provenance': { template_id: 'plan_templates.template_id (uuidv4)' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/contract-line-templates/{id}/create-contract-line',
    summary: 'Create contract line from template',
    description:
      'Creates a contract line from a template. Current controller validates body createPlanFromTemplateSchema and passes that body to service; path `{id}` is not used by service logic.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ContractLineTemplateParam, body: { schema: CreateFromTemplateBody } },
    responses: {
      201: { description: 'Contract line created from template.', schema: ContractLineApiSuccess },
      400: { description: 'Invalid request payload.', schema: ContractLineApiError },
      401: { description: 'x-api-key missing at middleware.', schema: ContractLineApiError },
      500: { description: 'Request context missing or template application failure.', schema: ContractLineApiError },
    },
    extensions: {
      ...commonExtensions,
      'x-path-id-ignored-currently': true,
    },
    edition: 'both',
  });
}
