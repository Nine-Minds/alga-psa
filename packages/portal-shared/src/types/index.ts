/**
 * Shared portal types consumed across packages.
 */

/**
 * Stable machine codes for portal invitation errors. These are emitted by
 * server actions/services so clients can look up a localized message instead
 * of displaying the English `error` string verbatim.
 */
export type PortalInvitationErrorCode =
  | 'TOKEN_REQUIRED'
  | 'TOKEN_AND_PASSWORD_REQUIRED'
  | 'PASSWORD_TOO_SHORT'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'TENANT_CONTEXT_REQUIRED'
  | 'RESET_PASSWORD_FAILED'
  | 'CREATE_USER_FAILED'
  | 'SETUP_FAILED'
  | 'VERIFICATION_FAILED'
  | 'INVITATION_FAILED';

export interface SendInvitationResult {
  success: boolean;
  invitationId?: string;
  message?: string;
  error?: string;
  errorCode?: PortalInvitationErrorCode;
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
  errorCode?: PortalInvitationErrorCode;
}

export interface CompleteSetupResult {
  success: boolean;
  userId?: string;
  username?: string;
  message?: string;
  error?: string;
  errorCode?: PortalInvitationErrorCode;
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
