import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import { clientBillingProfileResponseSchema } from '../../schemas/client';
import { registerArrayEnvelope, registerSuccessEnvelope } from '../responseSchemas';

/** Read-only client billing profile routes. */
export function registerClientBillingProfileRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Clients';

  const ClientBillingProfilesParams = registry.registerSchema(
    'ClientBillingProfilesParams',
    zOpenApi.object({ id: zOpenApi.string().guid().describe('Client UUID from clients.client_id.') }),
  );
  const ClientBillingProfileParams = registry.registerSchema(
    'ClientBillingProfileParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Client UUID from clients.client_id.'),
      profileId: zOpenApi.string().guid().describe('Billing profile UUID from client_billing_profiles.billing_profile_id. Must belong to the client in the path.'),
    }),
  );
  const ApiError = registry.registerSchema(
    'ClientBillingProfileApiError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const Resource = registry.registerSchema(
    'ClientBillingProfile',
    clientBillingProfileResponseSchema.extend({
      billing_profile_id: zOpenApi.string().uuid().describe('The billing_profile_id used on invoices, contract lines, tickets and assets.'),
      bill_to_location_name: zOpenApi.string().nullable().describe('Display name of bill_to_location_id; null when unset.'),
      billing_contact_name: zOpenApi.string().nullable().describe('Full name of billing_contact_id; null when unset.'),
      invoice_template_name: zOpenApi.string().nullable().describe('Name of the tenant invoice template in invoice_template_id; null when unset.'),
      is_tax_exempt: zOpenApi.boolean().nullable().describe('Null means inherit from the client. The same applies to other nullable settings.'),
    }),
  );
  const ListEnvelope = registerArrayEnvelope(registry, 'ClientBillingProfileListEnvelope', Resource);
  const ItemEnvelope = registerSuccessEnvelope(registry, 'ClientBillingProfileEnvelope', Resource);

  const errs = {
    400: { description: 'Invalid client or profile id format.', schema: ApiError },
    401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
    403: { description: 'Permission denied for client read.', schema: ApiError },
    500: { description: 'Unexpected billing profile failure.', schema: ApiError },
  };
  const extensions = { 'x-tenant-scoped': true, 'x-rbac-resource': 'client', 'x-rbac-action': 'read' };

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients/{id}/billing-profiles',
    summary: 'List client billing profiles',
    description:
      'Lists every billing profile of the client, including inactive ones: default profile first, then by name. billing_profile_id is the value used on invoices, contract lines, tickets and assets. Nullable settings mean "inherit from the client".',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientBillingProfilesParams },
    responses: {
      200: { description: 'Billing profiles returned.', schema: ListEnvelope },
      ...errs,
      404: { description: 'Client not found, or not visible to the caller.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/clients/{id}/billing-profiles/{profileId}',
    summary: 'Get a client billing profile',
    description:
      'Returns one billing profile of the client. billing_profile_id is the value used on invoices, contract lines, tickets and assets. A profile that belongs to another client returns 404, the same as an unknown one.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientBillingProfileParams },
    responses: {
      200: { description: 'Billing profile returned.', schema: ItemEnvelope },
      ...errs,
      404: { description: 'Billing profile not found for this client.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });
}
