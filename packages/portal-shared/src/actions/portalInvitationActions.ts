import type { IUser } from '@alga-psa/types';
import type {
  CompleteSetupResult,
  CreateClientPortalUserParams,
  InvitationHistoryItem,
  SendInvitationResult,
  VerifyTokenResult,
} from '../types';

type PortalActionsModule = {
  sendPortalInvitation: (contactId: string) => Promise<SendInvitationResult>;
  getPortalInvitations: (contactId: string) => Promise<InvitationHistoryItem[]>;
  revokePortalInvitation: (invitationId: string) => Promise<{ success: boolean; error?: string }>;
  verifyPortalToken: (token: string) => Promise<VerifyTokenResult>;
  completePortalSetup: (token: string, password: string) => Promise<CompleteSetupResult>;
  createClientPortalUser: (
    params: CreateClientPortalUserParams
  ) => Promise<{ success: boolean; userId?: string; message?: string; error?: string }>;
  uploadContactAvatar: (
    contactId: string,
    formData: FormData
  ) => Promise<{ success: boolean; message?: string; imageUrl?: string | null }>;
  deleteContactAvatar: (contactId: string) => Promise<{ success: boolean; message?: string }>;
  updateClientUser: (userId: string, userData: Partial<IUser>) => Promise<IUser | null>;
};

// Keep the specifier non-literal to avoid creating a static Nx project edge.
const CLIENT_PORTAL_ACTIONS_SPECIFIER = ['@alga-psa', 'client-portal', 'actions'].join('/');

async function loadPortalActions(): Promise<PortalActionsModule> {
  const loaded = await import(CLIENT_PORTAL_ACTIONS_SPECIFIER);
  return loaded as PortalActionsModule;
}

export async function sendPortalInvitation(contactId: string): Promise<SendInvitationResult> {
  const actions = await loadPortalActions();
  return actions.sendPortalInvitation(contactId);
}

export async function getPortalInvitations(contactId: string): Promise<InvitationHistoryItem[]> {
  const actions = await loadPortalActions();
  return actions.getPortalInvitations(contactId);
}

export async function revokePortalInvitation(
  invitationId: string
): Promise<{ success: boolean; error?: string }> {
  const actions = await loadPortalActions();
  return actions.revokePortalInvitation(invitationId);
}

export async function verifyPortalToken(token: string): Promise<VerifyTokenResult> {
  const actions = await loadPortalActions();
  return actions.verifyPortalToken(token);
}

export async function completePortalSetup(token: string, password: string): Promise<CompleteSetupResult> {
  const actions = await loadPortalActions();
  return actions.completePortalSetup(token, password);
}

export async function createClientPortalUser(
  params: CreateClientPortalUserParams
): Promise<{ success: boolean; userId?: string; message?: string; error?: string }> {
  const actions = await loadPortalActions();
  return actions.createClientPortalUser(params);
}

export async function uploadContactAvatar(
  contactId: string,
  formData: FormData
): Promise<{ success: boolean; message?: string; imageUrl?: string | null }> {
  const actions = await loadPortalActions();
  return actions.uploadContactAvatar(contactId, formData);
}

export async function deleteContactAvatar(
  contactId: string
): Promise<{ success: boolean; message?: string }> {
  const actions = await loadPortalActions();
  return actions.deleteContactAvatar(contactId);
}

export async function updateClientUser(userId: string, userData: Partial<IUser>): Promise<IUser | null> {
  const actions = await loadPortalActions();
  return actions.updateClientUser(userId, userData);
}
