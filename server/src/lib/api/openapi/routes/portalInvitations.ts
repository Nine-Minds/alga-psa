import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import { registerSuccessEnvelope } from '../responseSchemas';

/** Bulk client portal invitations. Both endpoints answer per contact, never all-or-nothing. */
export function registerPortalInvitationRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Portal Invitations';

  const ClientIdParams = registry.registerSchema(
    'PortalInvitationClientParams',
    zOpenApi.object({ id: zOpenApi.string().guid().describe('Client UUID from clients.client_id.') }),
  );

  const ApiError = registry.registerSchema(
    'PortalInvitationApiError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const ClientRequestBody = registry.registerSchema(
    'ClientPortalInvitationRequest',
    zOpenApi.object({
      contact_ids: zOpenApi.array(zOpenApi.string().guid()).min(1).max(500).optional().describe(
        'Contacts to invite. Ids that do not belong to the client in the path come back as skipped, never invited.',
      ),
      all_eligible: zOpenApi.boolean().optional().describe(
        'Invite every active contact of the client that has no client portal user yet. Ignored when contact_ids is given.',
      ),
      invitation_states: zOpenApi.array(zOpenApi.enum(['expired', 'pending'])).min(1).optional().describe(
        'Narrows the contacts to those whose latest invitation is expired and/or still pending — the chase-up case. A contact whose latest invitation was used or revoked is in neither state, whatever older invitations it has. A resend renews the link for the tenant\'s full invitation validity. Narrower than all_eligible, and it also narrows contact_ids: an id whose invitation is no longer in one of these states comes back as skipped with INVITATION_STATE_MISMATCH.',
      ),
    }).describe('Supply contact_ids, all_eligible=true, or invitation_states. One of the three is required.'),
  );

  const BulkRequestBody = registry.registerSchema(
    'BulkPortalInvitationRequest',
    zOpenApi.object({
      contact_ids: zOpenApi.array(zOpenApi.string().guid()).min(1).max(500).describe(
        'Contacts to invite, in any client. Each contact is authorized against its own client.',
      ),
    }),
  );

  const Result = registry.registerSchema(
    'PortalInvitationResult',
    zOpenApi.object({
      contact_id: zOpenApi.string().describe('contacts.contact_name_id.'),
      email: zOpenApi.string().optional().describe('Address the invitation went to, when the contact has one.'),
      status: zOpenApi.enum(['sent', 'skipped', 'failed']).describe(
        'sent: an invitation email went out. skipped: the contact is not invitable as it stands (no email, invalid email, already a portal user, shared mailbox, not in this client, or no longer in the requested invitation_states). failed: the invitation could not be delivered.',
      ),
      invitation_id: zOpenApi.string().optional().describe('portal_invitations.invitation_id of the invitation created.'),
      error_code: zOpenApi.string().optional().describe('Stable code for a skip or failure, e.g. USER_EXISTS_FOR_CONTACT.'),
      message: zOpenApi.string().optional(),
    }),
  );

  const ResultEnvelope = registerSuccessEnvelope(
    registry,
    'BulkPortalInvitationEnvelope',
    zOpenApi.object({
      total: zOpenApi.number().int().describe('Contacts considered by this request.'),
      sent: zOpenApi.number().int(),
      skipped: zOpenApi.number().int(),
      failed: zOpenApi.number().int(),
      results: zOpenApi.array(Result),
    }),
  );

  const errs = {
    400: { description: 'Invalid payload, no targets selected, more than 500 contacts, or the tenant is not configured to send invitations.', schema: ApiError },
    401: { description: 'API key missing/invalid or key user not found.', schema: ApiError },
    403: { description: 'Permission denied for user invite.', schema: ApiError },
    500: { description: 'Unexpected invitation failure.', schema: ApiError },
  };
  // Mailing up to 500 client contacts cannot be taken back, so an agent must
  // not run either endpoint unattended. The spec generator nests route
  // extensions under `extensions`, so the MCP/chat registries read the flag
  // from the curated override in ee/docs/api-registry/portal-invitations.json;
  // portalInvitationsOpenApi.test.ts asserts both stay true together.
  const extensions = {
    'x-tenant-scoped': true,
    'x-rbac-resource': 'user',
    'x-rbac-action': 'invite',
    'x-chat-approval-required': true,
  };

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/clients/{id}/portal-invitations',
    summary: 'Invite a client\'s contacts to the client portal',
    description:
      'Sends client portal invitations for one client: every eligible contact (all_eligible), only those whose invitation expired or is still pending (invitation_states), or a named subset (contact_ids) validated against the client in the path. Invitations go out one at a time, so a contact that cannot be invited never costs the rest of the batch theirs; the response reports each contact\'s outcome and the request is a 200 even when some were skipped or failed.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: ClientIdParams, body: { schema: ClientRequestBody } },
    responses: {
      200: { description: 'Per-contact invitation outcomes.', schema: ResultEnvelope },
      ...errs,
    },
    extensions,
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/portal-invitations/bulk',
    summary: 'Invite contacts to the client portal in bulk',
    description:
      'Sends client portal invitations for the named contacts, which may belong to different clients; each contact is authorized against its own client before anything is sent. Same per-contact result envelope as the client-scoped endpoint.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkRequestBody } },
    responses: {
      200: { description: 'Per-contact invitation outcomes.', schema: ResultEnvelope },
      ...errs,
    },
    extensions,
    edition: 'both',
  });
}
