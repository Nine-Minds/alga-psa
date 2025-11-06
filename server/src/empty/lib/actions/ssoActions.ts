export type SsoBulkAssignmentUserType = 'internal' | 'client';
export type SsoBulkAssignmentUserStatus =
  | 'linked'
  | 'would_link'
  | 'already_linked'
  | 'skipped_inactive';

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
  normalizedDomains: string[];
  providers: string[];
  userType: SsoBulkAssignmentUserType;
  preview: boolean;
}

export interface SsoBulkAssignmentRequest {
  providers: string[];
  domains: string[];
  userType: SsoBulkAssignmentUserType;
}

export interface SsoBulkAssignmentActionResponse {
  success: boolean;
  error?: string;
  result?: SsoBulkAssignmentResult;
}

export async function previewBulkSsoAssignment(
  _request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentResult> {
  return {
    summary: {
      scannedUsers: 0,
      matchedUsers: 0,
      providers: [],
    },
    details: [],
    normalizedDomains: [],
    providers: [],
    userType: 'internal',
    preview: true,
  };
}

export async function executeBulkSsoAssignment(
  _request: SsoBulkAssignmentRequest,
): Promise<SsoBulkAssignmentResult> {
  return {
    summary: {
      scannedUsers: 0,
      matchedUsers: 0,
      providers: [],
    },
    details: [],
    normalizedDomains: [],
    providers: [],
    userType: 'internal',
    preview: false,
  };
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
