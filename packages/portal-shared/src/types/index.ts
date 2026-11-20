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
  | 'INVITATION_FAILED'
  | 'PERMISSION_DENIED_INVITE'
  | 'PERMISSION_DENIED_CREATE'
  | 'EMAIL_NOT_CONFIGURED'
  | 'CONTACT_NOT_FOUND'
  | 'CONTACT_MISSING_EMAIL'
  | 'CONTACT_INVALID_EMAIL'
  | 'USER_EXISTS_FOR_CONTACT'
  | 'PORTAL_USER_ALREADY_EXISTS'
  | 'NO_DEFAULT_CLIENT'
  | 'NO_DEFAULT_LOCATION'
  | 'NO_LOCATION_EMAIL'
  | 'BASE_URL_NOT_CONFIGURED'
  | 'INVITATION_NOT_FOUND'
  | 'REVOKE_FAILED'
  | 'BATCH_LIMIT_EXCEEDED'
  | 'NO_TARGETS_SELECTED';

export interface SendInvitationResult {
  success: boolean;
  invitationId?: string;
  message?: string;
  /** True when the invitation adopted a portal account orphaned by a contact delete. */
  relinked?: boolean;
  error?: string;
  errorCode?: PortalInvitationErrorCode;
}

/**
 * Per-contact outcome of a bulk invitation run. `skipped` means the contact is
 * not invitable as it stands (no email, bad email, already a portal user, a
 * shared mailbox); `failed` means the invitation could not be delivered.
 */
export type BulkInvitationStatus = 'sent' | 'skipped' | 'failed';

export interface BulkSendInvitationItemResult {
  contactId: string;
  email?: string;
  status: BulkInvitationStatus;
  invitationId?: string;
  errorCode?: PortalInvitationErrorCode;
  message?: string;
}

export interface BulkSendInvitationResult {
  success: boolean;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  results: BulkSendInvitationItemResult[];
  error?: string;
  errorCode?: PortalInvitationErrorCode;
}

/**
 * A contact's standing with the client portal, as the MSP running a rollout
 * needs to see it: no portal user and no open invitation, an invitation that is
 * still usable, an invitation that lapsed unused, or a live portal user.
 */
export type PortalInvitationState = 'none' | 'pending' | 'expired' | 'active_user';

/** The invitation states a batch can be aimed at. */
export type PortalInvitationStateTarget = Extract<PortalInvitationState, 'pending' | 'expired'>;

export interface PortalInvitationContactState {
  contactId: string;
  state: PortalInvitationState;
  /** When a pending invitation lapses; null in every other state. */
  expiresAt: string | null;
}

export interface SendBulkPortalInvitationsParams {
  /** Restricts the batch to one client, and validates every explicit contact against it. */
  clientId?: string;
  /** Explicit contacts to invite. Takes precedence over `allEligible`. */
  contactIds?: string[];
  /** Invite every contact without a portal user (optionally within `clientId`). */
  allEligible?: boolean;
  /**
   * Narrows the eligible set to contacts whose invitation is in one of these
   * states — the chase-up case ("resend everything that expired"). Ignored when
   * `contactIds` is given, and narrower than `allEligible` when both are set.
   */
  invitationStates?: PortalInvitationStateTarget[];
}

export interface PortalInvitationEntraPrelink {
  provider: 'microsoft';
  providerAccountId: string;
  entraObjectId?: string;
  entraTenantId?: string;
}

export interface SendPortalInvitationOptions {
  entraPrelink?: PortalInvitationEntraPrelink;
}

export interface VerifyTokenResult {
  success: boolean;
  contact?: {
    contact_name_id: string;
    full_name: string;
    email: string;
    client_name: string;
  };
  prelinkedOAuth?: PortalInvitationEntraPrelink;
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

export type ClientUserActionError =
  | { readonly actionError: string }
  | { readonly permissionError: string };

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
