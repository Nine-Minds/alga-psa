import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import {
  clientLocationResponseSchema,
  clientResponseSchema,
  clientStatsResponseSchema,
} from '../../schemas/client';
import {
  registerArrayEnvelope,
  registerPaginatedEnvelope,
  registerSuccessEnvelope,
} from '../responseSchemas';

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
      client_type: zOpenApi.enum(['company', 'individual']).optional(),
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
      client_type: zOpenApi.enum(['company', 'individual']).optional(),
      tax_id_number: zOpenApi.string().optional(),
      notes: zOpenApi.string().optional(),
      properties: zOpenApi.record(zOpenApi.unknown()).optional(),
      payment_terms: zOpenApi.string().optional(),
      billing_cycle: zOpenApi.enum(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']),
      credit_limit: zOpenApi.number().min(0).optional(),
      default_currency_code: zOpenApi.string().min(3).max(3).optional(),
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

  const ContactResource = registry.registerSchema(
    'ContactResource',
    zOpenApi.object({
      contact_name_id: zOpenApi.string().uuid(),
      full_name: zOpenApi.string(),
      client_id: zOpenApi.string().uuid().nullable(),
      email: zOpenApi.string().email(),
      role: zOpenApi.string().nullable(),
      created_at: zOpenApi.string().datetime(),
      updated_at: zOpenApi.string().datetime(),
      is_inactive: zOpenApi.boolean(),
      tenant: zOpenApi.string().uuid(),
      phone_numbers: zOpenApi
        .array(
          zOpenApi.object({
            contact_phone_number_id: zOpenApi.string().uuid(),
            phone_number: zOpenApi.string(),
            normalized_phone_number: zOpenApi.string(),
            canonical_type: zOpenApi.string().nullable().optional(),
            custom_phone_type_id: zOpenApi.string().uuid().nullable().optional(),
            custom_type: zOpenApi.string().nullable(),
            is_default: zOpenApi.boolean(),
            display_order: zOpenApi.number().int().nonnegative(),
          }),
        )
        .optional(),
      additional_email_addresses: zOpenApi
        .array(
          zOpenApi.object({
            contact_additional_email_address_id: zOpenApi.string().uuid(),
            email_address: zOpenApi.string().email(),
            normalized_email_address: zOpenApi.string().email(),
            canonical_type: zOpenApi.string().nullable().optional(),
            custom_email_type_id: zOpenApi.string().uuid().nullable().optional(),
            custom_type: zOpenApi.string().nullable(),
            display_order: zOpenApi.number().int().nonnegative(),
          }),
        )
        .optional(),
      default_phone_number: zOpenApi.string().nullable().optional(),
      default_phone_type: zOpenApi.string().nullable().optional(),
      primary_email_canonical_type: zOpenApi.string().nullable().optional(),
      primary_email_custom_type_id: zOpenApi.string().uuid().nullable().optional(),
      primary_email_type: zOpenApi.string().nullable().optional(),
      notes: zOpenApi.string().nullable().optional(),
      avatarUrl: zOpenApi.string().nullable().optional(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
      client_name: zOpenApi.string().nullable().optional(),
    }),
  );

  const ContactStatsResource = registry.registerSchema(
    'ContactStatsResource',
    zOpenApi.object({
      total_contacts: zOpenApi.number(),
      active_contacts: zOpenApi.number(),
      inactive_contacts: zOpenApi.number(),
      contacts_with_client: zOpenApi.number(),
      contacts_without_client: zOpenApi.number(),
      contacts_by_role: zOpenApi.record(zOpenApi.number()),
      recent_contacts: zOpenApi.number(),
    }),
  );

  const ClientContractLineResource = registry.registerSchema(
    'ClientContractLineResource',
    zOpenApi.object({
      client_contract_line_id: zOpenApi.string().uuid(),
      client_id: zOpenApi.string().uuid(),
      contract_line_id: zOpenApi.string().uuid(),
      service_category: zOpenApi.string().nullable().optional(),
      start_date: zOpenApi.string().datetime(),
      end_date: zOpenApi.string().datetime().nullable().optional(),
      is_active: zOpenApi.boolean(),
      custom_rate: zOpenApi.number().nullable().optional(),
      client_contract_id: zOpenApi.string().uuid().nullable().optional(),
      tenant: zOpenApi.string().uuid().optional(),
    }),
  );

  const ContactExportRow = registry.registerSchema(
    'ContactExportRow',
    zOpenApi.object({
      contact_name_id: zOpenApi.string().uuid(),
      full_name: zOpenApi.string(),
      email: zOpenApi.string().email().nullable(),
      role: zOpenApi.string().nullable(),
      is_inactive: zOpenApi.boolean(),
      created_at: zOpenApi.string().datetime(),
      client_name: zOpenApi.string().nullable(),
      default_phone_number: zOpenApi.string().nullable(),
      default_phone_type: zOpenApi.string().nullable(),
    }),
  );

  const ClientEnvelope = registerSuccessEnvelope(registry, 'ClientEnvelope', clientResponseSchema);
  const PaginatedClientEnvelope = registerPaginatedEnvelope(registry, 'PaginatedClientEnvelope', clientResponseSchema);
  const ClientStatsEnvelope = registerSuccessEnvelope(registry, 'ClientStatsEnvelope', clientStatsResponseSchema);
  const ContactEnvelope = registerSuccessEnvelope(registry, 'ClientContactEnvelope', ContactResource);
  const PaginatedContactEnvelope = registerPaginatedEnvelope(registry, 'PaginatedContactEnvelope', ContactResource);
  const ContactSearchEnvelope = registerArrayEnvelope(registry, 'ContactSearchEnvelope', ContactResource);
  const ContactStatsEnvelope = registerSuccessEnvelope(registry, 'ContactStatsEnvelope', ContactStatsResource);
  const ClientLocationsEnvelope = registerArrayEnvelope(registry, 'ClientLocationsEnvelope', clientLocationResponseSchema);
  const ClientLocationEnvelope = registerSuccessEnvelope(registry, 'ClientLocationEnvelope', clientLocationResponseSchema);
  const ContactExportEnvelope = registerArrayEnvelope(registry, 'ContactExportEnvelope', ContactExportRow);

  const ClientContractLineListItem = registry.registerSchema(
    'ClientContractLineListItem',
    zOpenApi.object({
      data: zOpenApi.array(ClientContractLineResource),
      total: zOpenApi.number().int().nonnegative(),
    }),
  );
  const ClientContractLineListEnvelope = registerSuccessEnvelope(
    registry,
    'ClientContractLineListEnvelope',
    ClientContractLineListItem,
  );
  const ClientContractLineEnvelope = registerSuccessEnvelope(
    registry,
    'ClientContractLineEnvelope',
    ClientContractLineResource,
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients',
    summary: 'List clients',
    description: 'Inherited ApiBaseController list route for clients. Requires API-key auth and client:read permission.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ClientListQuery },
    responses: {
      200: { description: 'Paginated clients returned.', schema: PaginatedClientEnvelope },
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
      201: { description: 'Client created.', schema: ClientEnvelope },
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
      200: { description: 'Client returned.', schema: ClientEnvelope },
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
      200: { description: 'Client updated.', schema: ClientEnvelope },
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
      200: { description: 'Client stats returned.', schema: ClientStatsEnvelope },
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
      200: { description: 'Client contacts returned.', schema: PaginatedContactEnvelope },
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
      200: { description: 'Client locations returned.', schema: ClientLocationsEnvelope },
      400: { description: 'Invalid client id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client read.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected client locations failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read', 'x-deprecated-route-commented': true },
    edition: 'both',
  });

  // --- Client merge (absorbing a client as a billing profile) --------------

  const ClientMergeIdParams = registry.registerSchema(
    'ClientMergeIdParams',
    zOpenApi.object({ id: zOpenApi.string().uuid() }),
  );
  const BillingProfileContactsParams = registry.registerSchema(
    'BillingProfileContactsParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid(),
      profileId: zOpenApi.string().uuid(),
    }),
  );

  const ClientMergePreviewBody = registry.registerSchema(
    'ClientMergePreviewBody',
    zOpenApi.object({
      source_client_id: zOpenApi.string().uuid().describe('The client that would be absorbed.'),
    }),
  );

  const ClientMergePreviewResource = registry.registerSchema(
    'ClientMergePreviewResource',
    zOpenApi.object({
      sourceClientId: zOpenApi.string().uuid(),
      sourceClientName: zOpenApi.string(),
      targetClientId: zOpenApi.string().uuid(),
      targetClientName: zOpenApi.string(),
      blockers: zOpenApi.array(zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        i18nKey: zOpenApi.string(),
      })).describe('Non-empty means the merge would be refused.'),
      profiles: zOpenApi.array(zOpenApi.object({
        billingProfileId: zOpenApi.string().uuid(),
        currentName: zOpenApi.string(),
        mergedName: zOpenApi.string().describe('The name the profile takes on the destination client.'),
        isDefault: zOpenApi.boolean(),
        isActive: zOpenApi.boolean(),
      })),
      movedDefaultProfileId: zOpenApi.string().uuid().nullable(),
      counts: zOpenApi.record(zOpenApi.number()).describe('Rows that would move, by entity label.'),
      contacts: zOpenApi.array(zOpenApi.object({
        contactNameId: zOpenApi.string().uuid(),
        fullName: zOpenApi.string(),
        email: zOpenApi.string().nullable(),
        suggestedBillingProfileId: zOpenApi.string().uuid().nullable(),
      })),
      contracts: zOpenApi.array(zOpenApi.object({
        clientContractId: zOpenApi.string().uuid(),
        contractName: zOpenApi.string().nullable(),
        startDate: zOpenApi.string(),
        endDate: zOpenApi.string().nullable(),
        billingProfileId: zOpenApi.string().uuid().nullable(),
        isActive: zOpenApi.boolean(),
        suggestedChoice: zOpenApi.enum(['original', 'cutover']),
        suggestedCutoverDate: zOpenApi.string(),
      })),
      visibilityGroupRenames: zOpenApi.array(zOpenApi.object({
        groupId: zOpenApi.string().uuid(),
        from: zOpenApi.string(),
        to: zOpenApi.string(),
      })),
      unrestrictedPortalUserIds: zOpenApi.array(zOpenApi.string().uuid())
        .describe('Portal users of the source that currently see every billing profile.'),
      externalMappings: zOpenApi.array(zOpenApi.object({
        mappingId: zOpenApi.string(),
        integrationType: zOpenApi.string(),
        algaEntityType: zOpenApi.string(),
        externalEntityId: zOpenApi.string(),
        externalRealmId: zOpenApi.string().nullable(),
        targetAlreadyMapped: zOpenApi.boolean(),
      })),
    }),
  );

  const ClientMergeBody = registry.registerSchema(
    'ClientMergeBody',
    zOpenApi.object({
      source_client_id: zOpenApi.string().uuid(),
      contact_assignments: zOpenApi.array(zOpenApi.object({
        contact_name_id: zOpenApi.string().uuid(),
        billing_profile_id: zOpenApi.string().uuid(),
        is_manager: zOpenApi.boolean().optional(),
        can_view_profile_tickets: zOpenApi.boolean().optional(),
      })).optional(),
      contract_decisions: zOpenApi.array(zOpenApi.object({
        client_contract_id: zOpenApi.string().uuid(),
        choice: zOpenApi.enum(['original', 'cutover']),
        cutover_date: zOpenApi.string().nullable().optional(),
      })).optional(),
      pin_portal_grants: zOpenApi.boolean().optional()
        .describe('Defaults to true: records the billing segments unrestricted portal users have today.'),
      external_remap_choices: zOpenApi.array(zOpenApi.object({
        mapping_id: zOpenApi.string(),
        apply: zOpenApi.boolean(),
      })).optional(),
    }),
  );

  const ClientMergeResource = registry.registerSchema(
    'ClientMergeResource',
    zOpenApi.object({
      merge_id: zOpenApi.string().uuid(),
      source_client_id: zOpenApi.string().uuid(),
      target_client_id: zOpenApi.string().uuid(),
      moved_profile_ids: zOpenApi.array(zOpenApi.string().uuid()),
      moved_default_profile_id: zOpenApi.string().uuid().nullable(),
      counts: zOpenApi.record(zOpenApi.number()),
      remapped_external_mapping_ids: zOpenApi.array(zOpenApi.string()),
      skipped_external_mapping_ids: zOpenApi.array(zOpenApi.string()),
    }),
  );

  const BillingProfileContactResource = registry.registerSchema(
    'BillingProfileContactResource',
    zOpenApi.object({
      contact_name_id: zOpenApi.string().uuid(),
      full_name: zOpenApi.string(),
      email: zOpenApi.string().nullable(),
      is_manager: zOpenApi.boolean(),
      can_view_profile_tickets: zOpenApi.boolean()
        .describe('Lets this contact see every ticket attributed to the profile in the client portal.'),
    }),
  );

  const BillingProfileContactsBody = registry.registerSchema(
    'BillingProfileContactsBody',
    zOpenApi.object({
      contacts: zOpenApi.array(zOpenApi.object({
        contact_name_id: zOpenApi.string().uuid(),
        is_manager: zOpenApi.boolean().optional(),
        can_view_profile_tickets: zOpenApi.boolean().optional(),
      })).describe('Replaces the profile\'s contact list; omitting a contact removes it.'),
    }),
  );

  const ClientMergePreviewEnvelope = registerSuccessEnvelope(
    registry, 'ClientMergePreviewEnvelope', ClientMergePreviewResource);
  const ClientMergeEnvelope = registerSuccessEnvelope(
    registry, 'ClientMergeEnvelope', ClientMergeResource);
  const BillingProfileContactsEnvelope = registerArrayEnvelope(
    registry, 'BillingProfileContactsEnvelope', BillingProfileContactResource);

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/clients/{id}/merge/preview',
    summary: 'Preview a client merge',
    description:
      'Dry run of absorbing source_client_id into this client as a billing profile. Writes nothing; returns the profiles that would move, per-entity row counts, the contacts and contracts needing a decision, the portal users whose billing-segment access would widen, the accounting mappings that would need re-pointing, and any blockers.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientMergeIdParams, body: { schema: ClientMergePreviewBody } },
    responses: {
      200: { description: 'Merge preview returned.', schema: ClientMergePreviewEnvelope },
      400: { description: 'Invalid client id or request payload.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client update.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected merge preview failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/clients/{id}/merge',
    summary: 'Merge a client into this one',
    description:
      'Absorbs source_client_id into this client as a billing profile. The source\'s billing profiles are re-parented keeping their ids, so invoices, billing cycles, payment methods, credits and tax settings follow them; tickets, contacts, projects, assets, contracts, locations and portal visibility groups move to this client. The source client is archived with a forwarding marker. Irreversible. Requires client update and delete.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientMergeIdParams, body: { schema: ClientMergeBody } },
    responses: {
      200: { description: 'Merge completed.', schema: ClientMergeEnvelope },
      400: { description: 'Invalid payload, or the merge was refused (blockers are returned as validation details).', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client update or delete.', schema: ApiError },
      404: { description: 'Client not found.', schema: ApiError },
      500: { description: 'Unexpected merge failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'client',
      'x-rbac-action': 'update',
      // Irreversible and it retires a client: an agent must not run this
      // unattended, whatever the prompt says.
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients/{id}/billing-profiles/{profileId}/contacts',
    summary: 'List billing profile contacts',
    description:
      'Returns the contacts attached to a billing profile, with the manager designation and the separate grant that lets a contact see every ticket attributed to the profile in the client portal.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: BillingProfileContactsParams },
    responses: {
      200: { description: 'Billing profile contacts returned.', schema: BillingProfileContactsEnvelope },
      400: { description: 'Invalid client or profile id format.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client read.', schema: ApiError },
      404: { description: 'Billing profile not found for this client.', schema: ApiError },
      500: { description: 'Unexpected billing profile contacts failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/clients/{id}/billing-profiles/{profileId}/contacts',
    summary: 'Replace billing profile contacts',
    description:
      'Replaces the profile\'s contact list. At most one contact may be the manager. can_view_profile_tickets is a separate opt-in and defaults to false, so naming a manager never widens what they can read.',
    tags: [clientTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: BillingProfileContactsParams, body: { schema: BillingProfileContactsBody } },
    responses: {
      200: { description: 'Billing profile contacts replaced.', schema: BillingProfileContactsEnvelope },
      400: { description: 'Invalid payload, a second manager, or a contact from another client.', schema: ApiError },
      401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
      403: { description: 'Permission denied for client update.', schema: ApiError },
      404: { description: 'Billing profile not found for this client.', schema: ApiError },
      500: { description: 'Unexpected billing profile contacts failure.', schema: ApiError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  const ClientNotesResponse = registry.registerSchema(
    'ClientNotesResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        document: zOpenApi.unknown().nullable().describe('The linked notes document row, or null when the client has no notes.'),
        blockData: zOpenApi.unknown().nullable().describe('BlockNote block array for the notes body, or null.'),
        lastUpdated: zOpenApi.string().nullable().describe('ISO timestamp of the last notes update, or null.'),
      }),
    }),
  );
  const ClientNotesUpdateBody = registry.registerSchema(
    'ClientNotesUpdateBody',
    zOpenApi.object({
      blockData: zOpenApi.unknown().describe('Full BlockNote block array (or its JSON string). Replaces the existing notes document.'),
    }),
  );
  const clientNotesErrs = {
    400: { description: 'Invalid client id or request payload.', schema: ApiError },
    401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
    403: { description: 'Permission denied for client resource action.', schema: ApiError },
    404: { description: 'Client not found.', schema: ApiError },
    500: { description: 'Unexpected client notes failure.', schema: ApiError },
  };

  registry.registerRoute({
    method: 'get', path: '/api/v1/clients/{id}/notes',
    summary: 'Get client notes',
    description: 'Returns the BlockNote content of the client notes document (the rich-text notes shown on the client page), or null fields when no notes exist.',
    tags: [clientTag], security: [{ ApiKeyAuth: [] }], request: { params: ClientIdParam },
    responses: { 200: { description: 'Client notes content.', schema: ClientNotesResponse }, ...clientNotesErrs },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read' },
    edition: 'both',
  });
  registry.registerRoute({
    method: 'put', path: '/api/v1/clients/{id}/notes',
    summary: 'Update client notes',
    description: 'Creates or replaces the BlockNote notes document linked to the client. Send the full block array; partial updates are not merged. Returns the document id.',
    tags: [clientTag], security: [{ ApiKeyAuth: [] }], request: { params: ClientIdParam, body: { schema: ClientNotesUpdateBody } },
    responses: { 200: { description: 'Notes saved.', schema: zOpenApi.object({ data: zOpenApi.object({ document_id: zOpenApi.string().uuid() }) }) }, ...clientNotesErrs },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'update' },
    edition: 'both',
  });
  registry.registerRoute({
    method: 'delete', path: '/api/v1/clients/{id}/notes',
    summary: 'Delete client notes',
    description: 'Unlinks the notes document from the client. Pass delete_document=true to also hard-delete the document and its block content.',
    tags: [clientTag], security: [{ ApiKeyAuth: [] }],
    request: { params: ClientIdParam, query: zOpenApi.object({ delete_document: zOpenApi.enum(['true', 'false']).optional() }) },
    responses: { 200: { description: 'Notes unlinked/deleted.', schema: zOpenApi.object({ message: zOpenApi.string() }) }, ...clientNotesErrs },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'update' },
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
      201: { description: 'Client location created.', schema: ClientLocationEnvelope },
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
      200: { description: 'Paginated contacts returned.', schema: PaginatedContactEnvelope },
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
      201: { description: 'Contact created.', schema: ContactEnvelope },
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
      200: { description: 'Contact returned.', schema: ContactEnvelope },
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
      200: { description: 'Contact updated.', schema: ContactEnvelope },
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
      200: { description: 'Contact search results returned.', schema: ContactSearchEnvelope },
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
      200: { description: 'Contact export response. CSV format returns text/csv body; JSON format returns standard API envelope.', schema: ContactExportEnvelope },
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
      200: { description: 'Contact stats returned.', schema: ContactStatsEnvelope },
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
      'Lists client contract lines — contract_lines rows that belong to client contracts (joined via contract_id), with the owning client_id and client_contract_id surfaced. Supports client_id, contract_line_id, service_category, is_active, has_custom_rate, and start/end-date-range filters plus page/limit pagination. Authenticated and tenant-scoped via withApiKeyRouteAuth.',
    tags: [contractTag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ClientContractLineQuery },
    responses: {
      200: { description: 'Paginated client contract lines returned.', schema: ClientContractLineListEnvelope },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'x-api-key missing/invalid.', schema: ApiError },
      500: { description: 'Unhandled failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/client-contract-lines',
    summary: 'Assign contract line to client',
    description: 'Assigns one contract line to a client by cloning a template line into the client contract, using createClientContractLineSchema validation. Authenticated and tenant-scoped via withApiKeyRouteAuth.',
    tags: [contractTag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: ClientContractLineBody } },
    responses: {
      201: { description: 'Client contract line assignment created.', schema: ClientContractLineEnvelope },
      400: { description: 'Invalid request payload.', schema: ApiError },
      401: { description: 'x-api-key missing/invalid.', schema: ApiError },
      500: { description: 'Unhandled assignment failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
      'x-id-provenance': { client_contract_line_id: 'contract_lines.contract_line_id (client-owned line model)' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/client-contract-lines/{id}',
    summary: 'Unassign contract line from client',
    description: 'Deactivates the client-owned contract line for the provided id. Authenticated and tenant-scoped via withApiKeyRouteAuth.',
    tags: [contractTag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientContractLineIdParam },
    responses: {
      204: { description: 'Client contract line unassigned.', emptyBody: true },
      400: { description: 'Invalid assignment id format.', schema: ApiError },
      401: { description: 'x-api-key missing/invalid.', schema: ApiError },
      500: { description: 'Unassignment failure.', schema: ApiError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
    },
    edition: 'both',
  });
}
