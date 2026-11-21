/**
 * API Portal Invitation Controller
 *
 * Bulk client portal invitations over the REST API. The work itself is the
 * shared server action, so the API and the MSP UI invite by exactly the same
 * rules; the controller only authenticates the key, checks user:invite and
 * translates the action's result into the API envelope.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { BaseService } from './types';
import {
  bulkPortalInvitationRequestSchema,
  clientPortalInvitationRequestSchema,
  type BulkPortalInvitationResponse
} from '../schemas/portalInvitationSchemas';
import { sendBulkPortalInvitations } from '@alga-psa/portal-shared/actions/portalInvitationActions';
import type { BulkSendInvitationResult, SendBulkPortalInvitationsParams } from '@alga-psa/portal-shared/types';
import {
  AuthenticatedApiRequest,
  ForbiddenError,
  ValidationError,
  createSuccessResponse,
  handleApiError
} from '../middleware/apiMiddleware';

/** This controller owns no CRUD surface; the inherited handlers are never routed. */
const noCrudService: BaseService = {
  list: async () => { throw new Error('Not supported'); },
  getById: async () => { throw new Error('Not supported'); },
  create: async () => { throw new Error('Not supported'); },
  update: async () => { throw new Error('Not supported'); },
  delete: async () => { throw new Error('Not supported'); }
};

const CLIENT_ID_PATTERN = /\/clients\/([^/]+)\/portal-invitations/;

export class ApiPortalInvitationController extends ApiBaseController {
  constructor() {
    super(noCrudService, {
      resource: 'user',
      permissions: {
        create: 'invite',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
  }

  /** POST /api/v1/clients/{id}/portal-invitations */
  inviteClientContacts() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, 'invite');
          const clientId = this.extractClientId(apiRequest);
          const body = await this.validateData(apiRequest, clientPortalInvitationRequestSchema);
          return this.invite({
            clientId,
            contactIds: body.contact_ids,
            allEligible: body.all_eligible === true
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /** POST /api/v1/portal-invitations/bulk */
  inviteContacts() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, 'invite');
          const body = await this.validateData(apiRequest, bulkPortalInvitationRequestSchema);
          // No client in the path: the action authorizes each contact against
          // its own client before inviting it.
          return this.invite({ contactIds: body.contact_ids });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  private extractClientId(req: AuthenticatedApiRequest): string {
    const match = CLIENT_ID_PATTERN.exec(new URL(req.url).pathname);
    const clientId = match?.[1];
    if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
      throw new ValidationError('Invalid client ID format');
    }
    return clientId;
  }

  private async invite(params: SendBulkPortalInvitationsParams): Promise<NextResponse> {
    const result: BulkSendInvitationResult = await sendBulkPortalInvitations(params);

    if (!result.success) {
      const message = result.error || 'Portal invitations could not be sent';
      if (result.errorCode === 'PERMISSION_DENIED_INVITE') {
        throw new ForbiddenError(message);
      }
      throw new ValidationError(message, result.errorCode ? { code: result.errorCode } : undefined);
    }

    const payload: BulkPortalInvitationResponse = {
      total: result.total,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      results: result.results.map((item) => ({
        contact_id: item.contactId,
        email: item.email,
        status: item.status,
        invitation_id: item.invitationId,
        error_code: item.errorCode,
        message: item.message
      }))
    };

    return createSuccessResponse(payload);
  }
}
