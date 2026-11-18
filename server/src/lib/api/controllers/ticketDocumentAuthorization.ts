/**
 * The one ticket-attachment read gate. REST listing (`GET /tickets/{id}/documents`), REST download and the
 * MCP `read_attachment` content read all go through it, so a document is visible to one only if it is
 * visible to all.
 */
import type { Knex } from 'knex';
import {
  projectApiResourceRead,
  reprojectUnderDecision,
  type AuthorizedProjection,
} from './authorizationKernel';
import {
  TICKET_DOCUMENT_SOURCE,
  type RedactableRecordSource,
} from '@alga-psa/authorization/recordProjectionDescriptors';
import type { TicketService } from '../services/TicketService';
import { hasApiContextPermission } from '../middleware/apiContextPermission';
import { ForbiddenError, NotFoundError, type AuthenticatedApiRequest } from '../middleware/apiMiddleware';

type Projection = AuthorizedProjection<Record<string, any>>;

/** Denied OR suppressed answers 404 (403 would confirm the ticket exists); row-independent RBAC 403 happens earlier. */
export async function assertTicketReadGate(
  ticketService: TicketService,
  apiRequest: AuthenticatedApiRequest,
  ticketId: string,
  knex: Knex,
): Promise<Projection> {
  const ticket = await ticketService.getById(ticketId, apiRequest.context);
  if (!ticket) {
    throw new NotFoundError('ticket not found');
  }

  const projection = await projectApiResourceRead({
    knex,
    tenant: apiRequest.context.tenant,
    user: apiRequest.context.user,
    apiKeyId: apiRequest.context.apiKeyId,
    kind: 'ticket',
    record: ticket as Record<string, any>,
  });

  if (!projection) {
    throw new NotFoundError('ticket not found');
  }

  return projection;
}

/**
 * `ticket:read` (403), the ticket read kernel (404 on denial), then the ticket's documents as the service
 * exposes them: client-portal `is_client_visible` and the comment-attachment audience filter are already
 * applied. Returns the raw rows with the gate; callers reproject them under the source that matches what
 * they serialize.
 */
export async function authorizeTicketDocuments(
  ticketService: TicketService,
  apiRequest: AuthenticatedApiRequest,
  ticketId: string,
  knex: Knex,
): Promise<{ ticketGate: Projection; documents: Awaited<ReturnType<TicketService['getTicketDocuments']>> }> {
  if (!apiRequest.context.user) {
    throw new ForbiddenError('User context required');
  }
  if (!(await hasApiContextPermission(apiRequest.context, 'ticket', 'read', knex))) {
    throw new ForbiddenError('Permission denied: Cannot read ticket');
  }
  const ticketGate = await assertTicketReadGate(ticketService, apiRequest, ticketId, knex);
  const documents = await ticketService.getTicketDocuments(ticketId, apiRequest.context);
  return { ticketGate, documents };
}

/** One document of an already-authorized list, reprojected under `source`; 404 when it is absent or redacted away. */
export function selectTicketDocument(
  ticketGate: Projection,
  documents: ReadonlyArray<Record<string, any>>,
  documentId: string,
  source: RedactableRecordSource,
): Projection {
  const document = documents.find((item) => item.document_id === documentId);
  const projection = document ? reprojectUnderDecision(ticketGate, document, source) : null;
  if (!projection) {
    throw new NotFoundError('Document not found');
  }
  return projection;
}

export { TICKET_DOCUMENT_SOURCE };
