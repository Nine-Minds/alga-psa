/**
 * MSP "submit a service request on behalf of a client contact".
 *
 * Not a second write path: this module only substitutes the requester identity
 * (the contact, plus the contact's portal user when one exists) and delegates
 * to the portal's visibility engine and `submitPortalServiceRequest`.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  listVisibleServiceRequestCatalogItems,
  type ServiceRequestPortalCatalogItem,
} from './portalCatalog';
import { getVisiblePublishedServiceRequestDefinitionDetail } from './portalDetail';
import {
  submitPortalServiceRequest,
  type ServiceRequestSubmissionAttachmentInput,
  type SubmitPortalServiceRequestResult,
} from './submissionService';
import type { ServiceRequestRequester } from './requester';

export type MspSubmissionErrorCode = 'contact_not_found' | 'definition_not_visible';

export class MspSubmissionError extends Error {
  constructor(readonly code: MspSubmissionErrorCode, message: string) {
    super(message);
    this.name = 'MspSubmissionError';
  }
}

/**
 * Validates that the contact belongs to the client and resolves who the
 * requester is. The technician only ever lands in `submittedByUserId`; a
 * contact without an active client-portal user yields `requesterUserId: null`.
 */
export async function resolveRequesterForMspSubmission(
  knex: Knex,
  tenant: string,
  clientId: string,
  contactId: string,
  technicianUserId: string | null
): Promise<ServiceRequestRequester> {
  const db = tenantDb(knex, tenant);
  const contact = await db.table('contacts')
    .where({ contact_name_id: contactId, client_id: clientId })
    .first<{ contact_name_id: string } | undefined>('contact_name_id');
  if (!contact) {
    throw new MspSubmissionError('contact_not_found', 'Contact not found for this client');
  }

  const portalUser = await db.table('users')
    .where({ contact_id: contactId, user_type: 'client', is_inactive: false })
    .orderBy('created_at', 'asc')
    .first<{ user_id: string } | undefined>('user_id');

  return {
    clientId,
    contactId,
    requesterUserId: portalUser?.user_id ?? null,
    submittedByUserId: technicianUserId,
  };
}

/**
 * The catalog the contact would see in the client portal. Visibility provider
 * and audience predicate decide; nothing technician-specific is applied.
 */
export async function listDefinitionsForRequester(
  knex: Knex,
  tenant: string,
  requester: ServiceRequestRequester
): Promise<ServiceRequestPortalCatalogItem[]> {
  return listVisibleServiceRequestCatalogItems(knex, {
    tenant,
    requesterUserId: requester.requesterUserId,
    clientId: requester.clientId,
    contactId: requester.contactId,
  });
}

export interface SubmitOnBehalfOfMspInput {
  knex: Knex;
  tenant: string;
  definitionId: string;
  requester: ServiceRequestRequester;
  payload: Record<string, unknown>;
  attachments?: ServiceRequestSubmissionAttachmentInput[];
  clientSubmissionKey?: string | null;
}

export async function submitOnBehalfOfMsp(
  input: SubmitOnBehalfOfMspInput
): Promise<SubmitPortalServiceRequestResult> {
  const { knex, tenant, definitionId, requester } = input;
  if (!requester.submittedByUserId) {
    // Without a submitter this would be indistinguishable from a portal filing.
    throw new Error('An on-behalf-of submission requires a submitting user');
  }

  // Audience/visibility refusal up front, so a replay-key lookup can never
  // short-circuit past it and the refusal is a typed error.
  const visible = await getVisiblePublishedServiceRequestDefinitionDetail(
    knex,
    {
      tenant,
      requesterUserId: requester.requesterUserId,
      clientId: requester.clientId,
      contactId: requester.contactId,
    },
    definitionId
  );
  if (!visible) {
    throw new MspSubmissionError(
      'definition_not_visible',
      'Service request is not visible to this contact or not published'
    );
  }

  return submitPortalServiceRequest({
    knex,
    tenant,
    definitionId,
    requesterUserId: requester.requesterUserId,
    submittedByUserId: requester.submittedByUserId,
    clientId: requester.clientId,
    contactId: requester.contactId,
    payload: input.payload,
    attachments: input.attachments,
    clientSubmissionKey: input.clientSubmissionKey ?? null,
  });
}
