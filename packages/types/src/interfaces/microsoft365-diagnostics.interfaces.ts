import type {
  DiagnosticsStepStatus,
  DiagnosticsStep,
  DiagnosticsHttpMeta,
  DiagnosticsErrorMeta,
} from './diagnostics.interfaces';

export type {
  DiagnosticsStepStatus,
  DiagnosticsHttpMeta,
  DiagnosticsErrorMeta,
} from './diagnostics.interfaces';

/**
 * Microsoft 365 email diagnostics reuse the generic step envelope. The step
 * shape is intentionally identical so the email report contract is unchanged.
 */
export type Microsoft365DiagnosticsStep = DiagnosticsStep;

export interface Microsoft365DiagnosticsSummary {
  providerId: string;
  tenantId: string;
  providerType: 'microsoft';
  mailbox: string;
  folder: string;
  mailboxBasePath: '/me' | string;
  notificationUrl?: string;
  targetResource?: string;
  authenticatedUserEmail?: string;
  tokenExpiresAt?: string;
  overallStatus: DiagnosticsStepStatus;
}

export interface Microsoft365DiagnosticsReport {
  createdAt: string;
  summary: Microsoft365DiagnosticsSummary;
  steps: Microsoft365DiagnosticsStep[];
  recommendations: string[];
  supportBundle: Record<string, unknown>;
}

export interface Microsoft365DiagnosticsOptions {
  includeIdentifiers?: boolean;
  liveSubscriptionTest?: boolean;
  requiredScopes?: string[];
  folderListTop?: number;
}
