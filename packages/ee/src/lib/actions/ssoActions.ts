export type SsoBulkAssignmentUserType = 'internal' | 'client';
export type SsoBulkAssignmentUserStatus =
  | 'linked'
  | 'would_link'
  | 'already_linked'
  | 'skipped_inactive'
  | 'unlinked'
  | 'would_unlink'
  | 'already_unlinked';

export type SsoBulkAssignmentMode = 'link' | 'unlink';

export interface SsoBulkAssignmentDetail {
  tenant: string;
  userId: string;
  email: string;
  provider: string;
  status: SsoBulkAssignmentUserStatus;
}

export interface SsoBulkAssignmentProviderSummary {
  provider: string;
  candidates: number;
  linked: number;
  alreadyLinked: number;
  skippedInactive: number;
}

export interface SsoBulkAssignmentSummary {
  scannedUsers: number;
  matchedUsers: number;
  providers: SsoBulkAssignmentProviderSummary[];
}

export interface SsoBulkAssignmentResult {
  summary: SsoBulkAssignmentSummary;
  details: SsoBulkAssignmentDetail[];
  selectedUserIds: string[];
  providers: string[];
  userType: SsoBulkAssignmentUserType;
  preview: boolean;
  mode: SsoBulkAssignmentMode;
}

export interface SsoBulkAssignmentRequest {
  providers: string[];
  userIds: string[];
  userType?: SsoBulkAssignmentUserType;
  mode?: SsoBulkAssignmentMode;
}

export interface SsoBulkAssignmentActionResponse {
  success: boolean;
  error?: string;
  result?: SsoBulkAssignmentResult;
}

export interface SsoAssignableUser {
  userId: string;
  email: string;
  displayName: string;
  inactive: boolean;
  lastLoginAt: string | null;
  linkedProviders: string[];
}

export interface ListSsoAssignableUsersRequest {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListSsoAssignableUsersResponse {
  success: boolean;
  error?: string;
  users?: SsoAssignableUser[];
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

function emptyResult(preview: boolean): SsoBulkAssignmentResult {
  return {
    summary: {
      scannedUsers: 0,
      matchedUsers: 0,
      providers: [],
    },
    details: [],
    selectedUserIds: [],
    providers: [],
    userType: 'internal',
    preview,
    mode: 'link',
  };
}

export async function previewBulkSsoAssignment(
  _request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentResult> {
  return emptyResult(true);
}

export async function executeBulkSsoAssignment(
  _request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentResult> {
  return emptyResult(false);
}

export async function previewBulkSsoAssignmentAction(
  _request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentActionResponse> {
  return {
    success: false,
    error: 'Single Sign-On bulk assignment is available in the Enterprise edition.',
  };
}

export async function executeBulkSsoAssignmentAction(
  _request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentActionResponse> {
  return {
    success: false,
    error: 'Single Sign-On bulk assignment is available in the Enterprise edition.',
  };
}

export async function listSsoAssignableUsersAction(
  _params: ListSsoAssignableUsersRequest = {},
): Promise<ListSsoAssignableUsersResponse> {
  return {
    success: false,
    error: 'Single Sign-On bulk assignment is available in the Enterprise edition.',
  };
}
