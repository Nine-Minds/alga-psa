/**
 * Shared portal types consumed across packages.
 */
export interface SendInvitationResult {
  success: boolean;
  invitationId?: string;
  message?: string;
  error?: string;
}

export interface VerifyTokenResult {
  success: boolean;
  contact?: {
    contact_name_id: string;
    full_name: string;
    email: string;
    client_name: string;
  };
  error?: string;
}

export interface CompleteSetupResult {
  success: boolean;
  userId?: string;
  username?: string;
  message?: string;
  error?: string;
}

export interface InvitationHistoryItem {
  invitation_id: string;
  email: string;
  created_at: string;
  expires_at: string;
  used_at?: string;
  status: 'pending' | 'expired' | 'used' | 'revoked';
}

export interface CreateClientPortalUserParams {
  contactId?: string;
  password: string;
  roleId?: string;
  contact?: {
    email: string;
    fullName: string;
    clientId: string;
    isClientAdmin?: boolean;
  };
  requirePasswordChange?: boolean;
}
