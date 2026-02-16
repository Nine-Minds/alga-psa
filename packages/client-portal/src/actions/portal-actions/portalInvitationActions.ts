'use server'

import {
  createClientPortalUser as createClientPortalUserAction,
  sendPortalInvitation as sendPortalInvitationAction,
  verifyPortalToken as verifyPortalTokenAction,
  completePortalSetup as completePortalSetupAction,
  getPortalInvitations as getPortalInvitationsAction,
  revokePortalInvitation as revokePortalInvitationAction,
} from '@alga-psa/portal-shared/actions';
import type {
  SendInvitationResult as SharedSendInvitationResult,
  VerifyTokenResult as SharedVerifyTokenResult,
  CompleteSetupResult as SharedCompleteSetupResult,
  InvitationHistoryItem as SharedInvitationHistoryItem,
  CreateClientPortalUserParams as SharedCreateClientPortalUserParams,
} from '@alga-psa/portal-shared/types';

export interface SendInvitationResult extends SharedSendInvitationResult {}
export interface VerifyTokenResult extends SharedVerifyTokenResult {}
export interface CompleteSetupResult extends SharedCompleteSetupResult {}
export interface InvitationHistoryItem extends SharedInvitationHistoryItem {}
export interface CreateClientPortalUserParams extends SharedCreateClientPortalUserParams {}

export async function createClientPortalUser(
  params: CreateClientPortalUserParams
): Promise<{ success: boolean; userId?: string; message?: string; error?: string }> {
  return createClientPortalUserAction(params);
}

export async function sendPortalInvitation(contactId: string): Promise<SendInvitationResult> {
  return sendPortalInvitationAction(contactId);
}

export async function verifyPortalToken(token: string): Promise<VerifyTokenResult> {
  return verifyPortalTokenAction(token);
}

export async function completePortalSetup(token: string, password: string): Promise<CompleteSetupResult> {
  return completePortalSetupAction(token, password);
}

export async function getPortalInvitations(contactId: string): Promise<InvitationHistoryItem[]> {
  return getPortalInvitationsAction(contactId);
}

export async function revokePortalInvitation(
  invitationId: string
): Promise<{ success: boolean; error?: string }> {
  return revokePortalInvitationAction(invitationId);
}
