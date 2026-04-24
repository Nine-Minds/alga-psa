import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerSoftwareOneRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'SoftwareOne Extensions';

  const MiddlewareUnauthorizedResponse = registry.registerSchema(
    'MiddlewareUnauthorizedResponse',
    zOpenApi.object({
      error: zOpenApi.string().describe('Middleware authentication error message, such as Unauthorized: API key missing.'),
    }),
  );

  const SoftwareOneAgreement = registry.registerSchema(
    'SoftwareOneAgreement',
    zOpenApi.object({
      id: zOpenApi.string().describe('SoftwareOne agreement identifier, such as agr-001. This is an external SoftwareOne-style ID, not an Alga UUID.'),
      name: zOpenApi.string().describe('Human-readable agreement name.'),
      product: zOpenApi.string().describe('Product or SKU name associated with the agreement.'),
      vendor: zOpenApi.string().describe('Software vendor name, such as Microsoft or Adobe.'),
      consumer: zOpenApi.string().describe('End-customer organization name for the agreement.'),
      status: zOpenApi.enum(['active', 'inactive', 'pending', 'expired']).describe('Agreement status.'),
      currency: zOpenApi.string().describe('Three-letter billing currency code, such as USD.'),
      spxy: zOpenApi.number().describe('Annual SPx value from SoftwareOne dummy data.'),
      marginRpxy: zOpenApi.number().describe('Margin RPxY value from SoftwareOne dummy data.'),
      operations: zOpenApi.enum(['visible', 'hidden', 'restricted']).describe('Operational visibility state for the agreement.'),
      billingConfigId: zOpenApi.string().describe('SoftwareOne billing configuration identifier associated with the agreement.'),
      localConfig: zOpenApi
        .object({
          autoRenewal: zOpenApi.boolean().optional().describe('Whether local auto-renewal is enabled.'),
          notificationDays: zOpenApi.number().int().optional().describe('Days before renewal/expiry to notify.'),
          markup: zOpenApi.number().optional().describe('Optional local markup percentage used by richer SoftwareOne schemas.'),
          notes: zOpenApi.string().optional().describe('Optional local notes.'),
          tags: zOpenApi.array(zOpenApi.string()).optional().describe('Optional local tags.'),
        })
        .passthrough()
        .optional()
        .describe('Locally editable configuration metadata. Current MVP data includes autoRenewal and notificationDays.'),
    }),
  );

  const SoftwareOneAgreementDetail = registry.registerSchema(
    'SoftwareOneAgreementDetail',
    SoftwareOneAgreement.extend({
      startDate: zOpenApi.string().optional().describe('Agreement start date in YYYY-MM-DD format.'),
      endDate: zOpenApi.string().optional().describe('Agreement end date in YYYY-MM-DD format.'),
      billingCycle: zOpenApi.string().optional().describe('Billing cycle cadence, such as monthly or annual.'),
      paymentTerms: zOpenApi.string().optional().describe('Payment terms, such as Net 30.'),
      description: zOpenApi.string().optional().describe('Free-text agreement description.'),
      contactPerson: zOpenApi.string().optional().describe('Primary contact name for the agreement.'),
      contactEmail: zOpenApi.string().email().optional().describe('Primary contact email address.'),
      licenseCount: zOpenApi.number().int().optional().describe('Number of licenses covered by the agreement.'),
      pricePerLicense: zOpenApi.number().optional().describe('Price per license in the agreement currency.'),
    }),
  );

  const SoftwareOneStatement = registry.registerSchema(
    'SoftwareOneStatement',
    zOpenApi.object({
      id: zOpenApi.string().describe('SoftwareOne statement identifier, such as stmt-001. This is an external SoftwareOne-style ID, not an Alga UUID.'),
      statementNumber: zOpenApi.string().describe('Human-readable statement number, such as STMT-2024-001.'),
      period: zOpenApi.string().describe('Billing period in YYYY-MM format.'),
      consumer: zOpenApi.string().describe('End-customer organization name.'),
      consumerId: zOpenApi.string().describe('SoftwareOne consumer identifier.'),
      agreementName: zOpenApi.string().describe('Human-readable name of the associated agreement.'),
      agreementId: zOpenApi.string().describe('SoftwareOne agreement identifier associated with this statement.'),
      totalAmount: zOpenApi.number().describe('Total statement amount in the billing currency.'),
      currency: zOpenApi.string().describe('Three-letter billing currency code, such as USD.'),
      lineItemCount: zOpenApi.number().int().describe('Number of line-item charges on the statement.'),
      status: zOpenApi.enum(['draft', 'finalized', 'imported']).describe('Statement lifecycle status used by the MVP handler.'),
      dueDate: zOpenApi.string().describe('Payment due date in YYYY-MM-DD format.'),
      createdAt: zOpenApi.string().describe('ISO 8601 timestamp when the statement was created.'),
      importedAt: zOpenApi.string().nullable().describe('ISO 8601 timestamp when imported into Alga, or null if not imported.'),
      subtotal: zOpenApi.number().optional().describe('Statement subtotal before tax. Present on detail responses.'),
      taxAmount: zOpenApi.number().optional().describe('Statement tax amount. Present on detail responses.'),
      description: zOpenApi.string().optional().describe('Statement description. Present on detail responses.'),
      billingAddress: zOpenApi
        .object({
          client: zOpenApi.string().describe('Billing client organization name.'),
          street: zOpenApi.string().describe('Street address.'),
          city: zOpenApi.string().describe('City.'),
          state: zOpenApi.string().describe('State or province.'),
          zipCode: zOpenApi.string().describe('Postal or ZIP code.'),
          country: zOpenApi.string().describe('Country.'),
        })
        .optional()
        .describe('Billing address. Present on detail responses.'),
    }),
  );

  const SoftwareOnePaginationMeta = registry.registerSchema(
    'SoftwareOnePaginationMeta',
    zOpenApi.object({
      total: zOpenApi.number().int().describe('Total records returned by the current dummy implementation.'),
      page: zOpenApi.number().int().describe('Current page number. Currently hardcoded to 1.'),
      pageSize: zOpenApi.number().int().describe('Page size. Currently hardcoded to 50.'),
    }),
  );

  const SoftwareOneAgreementsListResponse = registry.registerSchema(
    'SoftwareOneAgreementsListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: zOpenApi.array(SoftwareOneAgreement).describe('SoftwareOne agreement records.'),
      meta: SoftwareOnePaginationMeta,
    }),
  );

  const SoftwareOneAgreementDetailResponse = registry.registerSchema(
    'SoftwareOneAgreementDetailResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: SoftwareOneAgreementDetail,
    }),
  );

  const SoftwareOneStatementsListResponse = registry.registerSchema(
    'SoftwareOneStatementsListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: zOpenApi.array(SoftwareOneStatement).describe('SoftwareOne statement records.'),
      meta: SoftwareOnePaginationMeta,
    }),
  );

  const SoftwareOneStatementDetailResponse = registry.registerSchema(
    'SoftwareOneStatementDetailResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: SoftwareOneStatement,
    }),
  );

  const SoftwareOneCharge = registry.registerSchema(
    'SoftwareOneCharge',
    zOpenApi.object({
      id: zOpenApi.string().describe('SoftwareOne charge identifier, unique within the statement, such as 1-1.'),
      statementId: zOpenApi.string().describe('Parent SoftwareOne statement identifier, such as stmt-001.'),
      description: zOpenApi.string().describe('Human-readable line item description.'),
      product: zOpenApi.string().describe('Product or SKU for the charge.'),
      quantity: zOpenApi.number().describe('Quantity billed for this line item.'),
      unitPrice: zOpenApi.number().describe('Unit price in the statement currency.'),
      totalAmount: zOpenApi.number().describe('Total line amount.'),
      agreementId: zOpenApi.string().describe('Related SoftwareOne agreement identifier, such as agr-001.'),
      period: zOpenApi.string().describe('Billing period in YYYY-MM format.'),
      category: zOpenApi.string().describe('Charge category, such as Software License, Compute, Storage, or Support.'),
    }),
  );

  const SoftwareOneChargesListResponse = registry.registerSchema(
    'SoftwareOneChargesListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: zOpenApi.array(SoftwareOneCharge).describe('Charge line items for the requested statement. Unknown statement IDs return an empty array.'),
      meta: zOpenApi.object({
        total: zOpenApi.number().int().describe('Number of charge records returned.'),
        statementId: zOpenApi.string().describe('Statement ID from the path parameter.'),
      }),
    }),
  );

  const SoftwareOneFullSyncResponse = registry.registerSchema(
    'SoftwareOneFullSyncResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Sync request completed successfully.'),
      message: zOpenApi.string().describe('Human-readable sync result message.'),
      data: zOpenApi.object({
        agreementsCount: zOpenApi.number().int().describe('Number of agreements synced. Zero when syncAgreements is false.'),
        statementsCount: zOpenApi.number().int().describe('Number of statements synced. Zero when syncStatements is false.'),
        syncedAt: zOpenApi.string().datetime().describe('ISO timestamp when the dummy sync completed.'),
      }),
    }),
  );

  const ExtensionIdParams = registry.registerSchema(
    'ExtensionIdParams',
    zOpenApi.object({
      extensionId: zOpenApi.string().describe('Extension identifier from the URL. The MVP generic routes accept any value and echo it in response metadata.'),
    }),
  );

  const ExtensionScopedIdParams = registry.registerSchema(
    'ExtensionScopedIdParams',
    zOpenApi.object({
      extensionId: zOpenApi.string().describe('Extension identifier from the URL. The MVP generic routes accept any value and echo it in response metadata.'),
      id: zOpenApi.string().describe('SoftwareOne-style external record identifier, such as agr-001 or stmt-001. This is not an Alga UUID.'),
    }),
  );

  const GenericExtensionAgreementsListResponse = registry.registerSchema(
    'GenericExtensionAgreementsListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: zOpenApi.array(SoftwareOneAgreement).describe('Agreement records returned by the generic extension MVP handler.'),
      meta: zOpenApi.object({
        total: zOpenApi.number().int().describe('Number of agreements returned.'),
        extensionId: zOpenApi.string().describe('Extension ID echoed from the path.'),
      }),
    }),
  );

  const GenericExtensionAgreementDetailResponse = registry.registerSchema(
    'GenericExtensionAgreementDetailResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: SoftwareOneAgreementDetail,
      meta: zOpenApi.object({
        extensionId: zOpenApi.string().describe('Extension ID echoed from the path.'),
      }),
    }),
  );

  const GenericExtensionStatementsListResponse = registry.registerSchema(
    'GenericExtensionStatementsListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Request succeeded.'),
      data: zOpenApi.array(SoftwareOneStatement).describe('Statement records returned by the generic extension MVP handler.'),
      meta: zOpenApi.object({
        total: zOpenApi.number().int().describe('Number of statements returned.'),
        extensionId: zOpenApi.string().describe('Extension ID echoed from the path.'),
      }),
    }),
  );

  const SoftwareOneSyncResponse = registry.registerSchema(
    'SoftwareOneSyncResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Sync request completed successfully.'),
      message: zOpenApi.string().describe('Human-readable sync result message.'),
      count: zOpenApi.number().int().describe('Number of dummy records included in the sync result.'),
    }),
  );

  const SoftwareOneSyncRequest = registry.registerSchema(
    'SoftwareOneSyncRequest',
    zOpenApi
      .object({
        fullSync: zOpenApi.boolean().optional().describe('Optional future full-sync flag. Currently ignored by the MVP handlers.'),
        syncStatements: zOpenApi.boolean().optional().describe('Optional future statement sync flag. Currently ignored by the MVP handlers.'),
        syncAgreements: zOpenApi.boolean().optional().describe('Optional future agreement sync flag. Currently ignored by the MVP handlers.'),
      })
      .passthrough()
      .describe('Sync options. The current SoftwareOne MVP handlers parse JSON but ignore all body fields.'),
  );

  const SoftwareOneErrorResponse = registry.registerSchema(
    'SoftwareOneErrorResponse',
    zOpenApi.object({
      success: zOpenApi.literal(false).describe('Request failed.'),
      error: zOpenApi.string().describe('Human-readable error message.'),
    }),
  );

  const SoftwareOneIdParams = registry.registerSchema(
    'SoftwareOneIdParams',
    zOpenApi.object({
      id: zOpenApi.string().describe('SoftwareOne external identifier, such as agr-001 or stmt-001. This is not an Alga UUID.'),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/softwareone/agreements',
    summary: 'List SoftwareOne agreements',
    description:
      'Returns SoftwareOne agreement records available to the SoftwareOne extension. The current handler is an MVP placeholder backed by hardcoded dummy data; comments in the route indicate that a full implementation will validate permissions, derive tenant context, fetch from the SoftwareOne API, and apply filtering, sorting, and pagination. This route is not in the middleware API-key skip list, so callers must provide x-api-key at the API layer.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: {
        description: 'Agreement list returned successfully.',
        schema: SoftwareOneAgreementsListResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected failure while fetching agreements.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/extensions/softwareone/agreements',
    summary: 'Sync SoftwareOne agreements',
    description:
      'Triggers the SoftwareOne agreements sync placeholder. The current handler parses the JSON body but ignores all fields, then returns a dummy count. A full implementation is expected to validate permissions, derive tenant context, call the SoftwareOne API, persist agreements, and return actual sync counts. This route is not in the middleware API-key skip list, so callers must provide x-api-key at the API layer.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: SoftwareOneSyncRequest,
        description: 'Optional sync options. Currently ignored by the MVP handler.',
      },
    },
    responses: {
      200: {
        description: 'Agreements sync placeholder completed successfully.',
        schema: SoftwareOneSyncResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected failure while syncing agreements.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/softwareone/agreements/{id}',
    summary: 'Get SoftwareOne agreement',
    description:
      'Returns one SoftwareOne agreement by external agreement ID, including additional detail fields such as dates, payment terms, contact, and license count. The current handler is an MVP placeholder backed by hardcoded dummy data. The id path parameter is a SoftwareOne-style string such as agr-001, not an Alga UUID.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: SoftwareOneIdParams,
    },
    responses: {
      200: {
        description: 'Agreement detail returned successfully.',
        schema: SoftwareOneAgreementDetailResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      404: {
        description: 'Agreement not found.',
        schema: SoftwareOneErrorResponse,
      },
      500: {
        description: 'Unexpected failure while fetching agreement detail.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/softwareone/statements',
    summary: 'List SoftwareOne statements',
    description:
      'Returns SoftwareOne billing statement records available to the SoftwareOne extension. The current handler is an MVP placeholder backed by hardcoded dummy data; comments in the route indicate that a full implementation will validate permissions, derive tenant context, fetch from the SoftwareOne API, and apply filtering, sorting, and pagination. This route is not in the middleware API-key skip list, so callers must provide x-api-key at the API layer.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: {
        description: 'Statement list returned successfully.',
        schema: SoftwareOneStatementsListResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected failure while fetching statements.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/extensions/softwareone/statements',
    summary: 'Sync SoftwareOne statements',
    description:
      'Triggers the SoftwareOne statements sync placeholder. The current handler parses the JSON body but ignores all fields, then returns a dummy count. A full implementation is expected to validate permissions, derive tenant context, call the SoftwareOne API, persist statements, and return actual sync counts. This route is not in the middleware API-key skip list, so callers must provide x-api-key at the API layer.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: SoftwareOneSyncRequest,
        description: 'Optional sync options. Currently ignored by the MVP handler.',
      },
    },
    responses: {
      200: {
        description: 'Statements sync placeholder completed successfully.',
        schema: SoftwareOneSyncResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected failure while syncing statements.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/softwareone/statements/{id}',
    summary: 'Get SoftwareOne statement',
    description:
      'Returns one SoftwareOne billing statement by external statement ID, including additional detail fields such as subtotal, tax amount, description, and billing address. The current handler is an MVP placeholder backed by hardcoded dummy data. The id path parameter is a SoftwareOne-style string such as stmt-001, not an Alga UUID.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: SoftwareOneIdParams,
    },
    responses: {
      200: {
        description: 'Statement detail returned successfully.',
        schema: SoftwareOneStatementDetailResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      404: {
        description: 'Statement not found.',
        schema: SoftwareOneErrorResponse,
      },
      500: {
        description: 'Unexpected failure while fetching statement detail.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/softwareone/statements/{id}/charges',
    summary: 'List SoftwareOne statement charges',
    description:
      'Returns line-item charges for a SoftwareOne billing statement. The current handler is an MVP placeholder backed by hardcoded dummy data keyed by SoftwareOne statement IDs such as stmt-001. Unknown statement IDs return 200 with an empty data array rather than 404. The id path parameter is not an Alga UUID.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: SoftwareOneIdParams,
    },
    responses: {
      200: {
        description: 'Charge list returned successfully. Data may be empty when the statement ID is unknown.',
        schema: SoftwareOneChargesListResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected failure while fetching statement charges.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/extensions/softwareone/sync',
    summary: 'Sync SoftwareOne data',
    description:
      'Triggers the SoftwareOne aggregate sync placeholder. The current handler accepts optional syncAgreements and syncStatements booleans, waits briefly to simulate work, and returns dummy counts and a syncedAt timestamp. A full implementation will validate permissions, derive tenant context, connect to the SoftwareOne API, and persist agreement and statement data.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: SoftwareOneSyncRequest,
        description: 'Sync options. The current sync endpoint consumes syncAgreements and syncStatements; unknown fields are ignored.',
        required: false,
      },
    },
    responses: {
      200: {
        description: 'Sync placeholder completed successfully with dummy counts.',
        schema: SoftwareOneFullSyncResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected failure while syncing SoftwareOne data.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension': 'softwareone',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/{extensionId}/agreements',
    summary: 'List agreements for extension',
    description:
      'Generic extension agreements placeholder. The current handler accepts any extensionId, performs no handler-level extension validation, and returns hardcoded SoftwareOne-style agreement data with meta.extensionId echoed from the path. A full implementation will validate the extension ID, check permissions, derive tenant context, and fetch extension-specific data.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ExtensionIdParams,
    },
    responses: {
      200: {
        description: 'Agreement list returned successfully for the requested extension placeholder.',
        schema: GenericExtensionAgreementsListResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected failure while fetching extension agreements.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension-scoped': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/{extensionId}/agreements/{id}',
    summary: 'Get agreement for extension',
    description:
      'Generic extension agreement detail placeholder. The current handler accepts any extensionId, looks up an agreement by SoftwareOne-style external ID such as agr-001, and returns hardcoded detail data with meta.extensionId echoed from the path. The id path parameter is not an Alga UUID.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ExtensionScopedIdParams,
    },
    responses: {
      200: {
        description: 'Agreement detail returned successfully for the requested extension placeholder.',
        schema: GenericExtensionAgreementDetailResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      404: {
        description: 'Agreement not found.',
        schema: SoftwareOneErrorResponse,
      },
      500: {
        description: 'Unexpected failure while fetching extension agreement detail.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension-scoped': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/extensions/{extensionId}/statements',
    summary: 'List statements for extension',
    description:
      'Generic extension statements placeholder. The current handler accepts any extensionId, performs no handler-level extension validation, and returns hardcoded SoftwareOne-style statement data with meta.extensionId echoed from the path. A full implementation will validate the extension ID, check permissions, derive tenant context, and fetch extension-specific data.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ExtensionIdParams,
    },
    responses: {
      200: {
        description: 'Statement list returned successfully for the requested extension placeholder.',
        schema: GenericExtensionStatementsListResponse,
      },
      401: {
        description: 'API key missing at middleware before the handler executes.',
        schema: MiddlewareUnauthorizedResponse,
      },
      500: {
        description: 'Unexpected failure while fetching extension statements.',
        schema: SoftwareOneErrorResponse,
      },
    },
    extensions: {
      'x-placeholder-implementation': true,
      'x-extension-scoped': true,
    },
    edition: 'both',
  });
}
