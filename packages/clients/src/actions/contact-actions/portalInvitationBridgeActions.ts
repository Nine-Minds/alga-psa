'use server'

import {
  sendPortalInvitation as sendPortalInvitationAction,
  getPortalInvitations as getPortalInvitationsAction,
  revokePortalInvitation as revokePortalInvitationAction,
  updateClientUser as updateClientUserAction
} from '@alga-psa/portal-shared/actions';
import type { IUser } from '@alga-psa/types';
import type {
  SendInvitationResult,
  InvitationHistoryItem
} from '@alga-psa/portal-shared/types';

export async function sendPortalInvitation(contactId: string): Promise<SendInvitationResult> {
  return sendPortalInvitationAction(contactId);
}

export async function getPortalInvitations(contactId: string): Promise<InvitationHistoryItem[]> {
  return getPortalInvitationsAction(contactId);
}

export async function revokePortalInvitation(invitationId: string): Promise<{ success: boolean; error?: string }> {
  return revokePortalInvitationAction(invitationId);
}

export async function updateClientUser(userId: string, data: { is_inactive?: boolean }): Promise<IUser | null> {
  return updateClientUserAction(userId, data);
}
