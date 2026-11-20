'use server'

import {
  sendPortalInvitation as sendPortalInvitationAction,
  sendBulkPortalInvitations as sendBulkPortalInvitationsAction,
  getPortalInvitations as getPortalInvitationsAction,
  getPortalInvitationStatesForClient as getPortalInvitationStatesForClientAction,
  revokePortalInvitation as revokePortalInvitationAction,
  updateClientUser as updateClientUserAction
} from '@alga-psa/portal-shared/actions/portalInvitationActions';
import type { IUser } from '@alga-psa/types';
import type {
  SendInvitationResult,
  BulkSendInvitationResult,
  SendBulkPortalInvitationsParams,
  InvitationHistoryItem,
  PortalInvitationContactState,
  PortalInvitationErrorCode,
  SendPortalInvitationOptions,
  ClientUserActionError
} from '@alga-psa/portal-shared/types';

export async function sendPortalInvitation(
  contactId: string,
  options?: SendPortalInvitationOptions
): Promise<SendInvitationResult> {
  return sendPortalInvitationAction(contactId, options);
}

export async function sendBulkPortalInvitations(
  params: SendBulkPortalInvitationsParams
): Promise<BulkSendInvitationResult> {
  return sendBulkPortalInvitationsAction(params);
}

export async function getPortalInvitations(contactId: string): Promise<InvitationHistoryItem[]> {
  return getPortalInvitationsAction(contactId);
}

export async function getPortalInvitationStatesForClient(
  clientId: string
): Promise<PortalInvitationContactState[] | null> {
  return getPortalInvitationStatesForClientAction(clientId);
}

export async function revokePortalInvitation(
  invitationId: string
): Promise<{ success: boolean; error?: string; errorCode?: PortalInvitationErrorCode }> {
  return revokePortalInvitationAction(invitationId);
}

export async function updateClientUser(
  userId: string,
  data: { is_inactive?: boolean }
): Promise<IUser | null | ClientUserActionError> {
  return updateClientUserAction(userId, data);
}
