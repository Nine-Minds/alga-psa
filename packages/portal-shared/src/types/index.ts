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
  /** The contact is deactivated, so a link mailed to it could never be used. */
  | 'CONTACT_INACTIVE'
  | 'USER_EXISTS_FOR_CONTACT'
  | 'PORTAL_USER_ALREADY_EXISTS'
  | 'NO_DEFAULT_CLIENT'
  | 'NO_DEFAULT_LOCATION'
  | 'NO_LOCATION_EMAIL'
  | 'BASE_URL_NOT_CONFIGURED'
  | 'INVITATION_NOT_FOUND'
  | 'REVOKE_FAILED'
  | 'BATCH_LIMIT_EXCEEDED'
  | 'NO_TARGETS_SELECTED'
  /** The contact's latest invitation is no longer in the state the batch targeted. */
  | 'INVITATION_STATE_MISMATCH'
  /** Too many invitations were attempted for this contact; the UI translates the wait. */
  | 'RATE_LIMITED';

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
 * needs to see it: no outstanding invitation, an invitation that is still
 * usable, an invitation that lapsed unused, a live portal user, or a portal
 * user that was deactivated. Derived from the contact's latest invitation only.
 */
export type PortalInvitationState =
  | 'none'
  | 'pending'
  | 'expired'
  | 'active_user'
  | 'inactive_user';

/** The invitation states a batch can be aimed at. */
export type PortalInvitationStateTarget = Extract<PortalInvitationState, 'pending' | 'expired'>;

export interface PortalInvitationContactState {
  contactId: string;
  state: PortalInvitationState;
  /** When a pending invitation lapses; null in every other state. */
  expiresAt: string | null;
  /**
   * True when the contact's email is already held by a user the invitation
   * cannot adopt (an internal user, or another contact's portal user), which is
   * the same rule the send path refuses on. Lets a preview count only what will
   * actually be mailed.
   */
  emailConflict: boolean;
  /**
   * True when the contact is deactivated. Such a contact cannot be invited and
   * cannot use a link already in its mailbox, so an outstanding invitation on it
   * is reported as unusable rather than as something to chase up.
   */
  contactInactive: boolean;
}

export interface SendBulkPortalInvitationsParams {
  /** Restricts the batch to one client, and validates every explicit contact against it. */
  clientId?: string;
  /** Explicit contacts to invite. Takes precedence over `allEligible`. */
  contactIds?: string[];
  /** Invite every contact without a portal user (optionally within `clientId`). */
  allEligible?: boolean;
  /**
   * Narrows the batch to contacts whose latest invitation is in one of these
   * states — the chase-up case ("resend everything that expired"). Narrower
   * than `allEligible`, and it also narrows an explicit `contactIds` list: an
   * id whose invitation is no longer in one of these states is skipped rather
   * than mailed, so the batch can never outrun what the sender was shown.
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
  /** When the invitation was last mailed again; absent until it is resent. */
  last_sent_at?: string;
  /** How many times the invitation was mailed again after it was created. */
  resend_count?: number;
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
