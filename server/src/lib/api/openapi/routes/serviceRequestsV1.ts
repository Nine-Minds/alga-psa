import type { ZodTypeAny } from 'zod';
import {
  serviceRequestCatalogQuerySchema,
  serviceRequestSubmissionBodySchema,
  serviceRequestSubmissionParamsSchema,
} from '../../schemas/serviceRequestSubmission';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerServiceRequestsV1Routes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tag = 'Service Requests';

  const CatalogQuery = registry.registerSchema('ServiceRequestCatalogQuery', serviceRequestCatalogQuerySchema);
  const SubmissionParams = registry.registerSchema('ServiceRequestSubmissionParams', serviceRequestSubmissionParamsSchema);
  const SubmissionRequest = registry.registerSchema('ServiceRequestSubmissionRequest', serviceRequestSubmissionBodySchema);

  const CatalogItem = registry.registerSchema(
    'ServiceRequestCatalogItem',
    zOpenApi.object({
      definitionId: zOpenApi.string().uuid(),
      title: zOpenApi.string(),
      description: zOpenApi.string().nullable(),
      icon: zOpenApi.string().nullable(),
      categoryId: zOpenApi.string().uuid().nullable(),
      categoryName: zOpenApi.string().nullable(),
      sortOrder: zOpenApi.number(),
    }),
  );
  const CatalogEnvelope = registry.registerSchema(
    'ServiceRequestCatalogEnvelope',
    zOpenApi.object({ data: zOpenApi.array(CatalogItem) }),
  );
  const SubmissionEnvelope = registry.registerSchema(
    'ServiceRequestSubmissionEnvelope',
    zOpenApi.object({
      data: zOpenApi.object({
        submissionId: zOpenApi.string().uuid(),
        executionStatus: zOpenApi.enum(['pending', 'succeeded', 'failed']),
        ticketId: zOpenApi.string().uuid().nullable(),
      }),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/service-requests/catalog',
    summary: 'List the service requests a client contact can see',
    description:
      'Returns the published service-request catalog exactly as the contact would see it in the client portal (visibility provider and audience applied). Use it to discover definitionId values for the submissions endpoint.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: CatalogQuery },
    responses: {
      200: { description: 'Catalog returned successfully.', schema: CatalogEnvelope },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks service:read.', schema: deps.ErrorResponse },
      404: { description: 'The contact does not exist or does not belong to the client.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'service',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/service-requests/{definitionId}/submissions',
    summary: 'Submit a service request on behalf of a client contact',
    description:
      'Files a published service request for a client contact. The contact is the requester (their active portal user, when one exists) and the API-key user is recorded as the submitter; the ticket is entered by the API-key user with origin internal/source msp. Send clientSubmissionKey to make retries idempotent: a repeated key returns the original submission with 200.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: SubmissionParams,
      body: { schema: SubmissionRequest, description: 'Client, contact and answers keyed by form field key.' },
    },
    responses: {
      200: { description: 'Replay of an earlier submission with the same clientSubmissionKey.', schema: SubmissionEnvelope },
      201: { description: 'Submission created.', schema: SubmissionEnvelope },
      400: { description: 'Validation failed (body or required answers).', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks service:create.', schema: deps.ErrorResponse },
      404: { description: 'Contact not in the client, or the definition is not visible to the contact.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'service',
    },
    edition: 'both',
  });
}
