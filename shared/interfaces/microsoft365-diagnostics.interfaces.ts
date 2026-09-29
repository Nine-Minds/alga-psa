import type {
  DiagnosticsStepStatus,
  DiagnosticsStep,
} from '@alga-psa/types';

export type {
  DiagnosticsStepStatus,
  DiagnosticsHttpMeta,
  DiagnosticsErrorMeta,
} from '@alga-psa/types';

/**
 * Shared mirror of the canonical Microsoft 365 diagnostics contract in
 * `@alga-psa/types`. The generic step envelope now lives in
 * `diagnostics.interfaces`, so the email step is an alias of it.
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
  diagnosticSource?: 'oauth_callback';
  diagnosticCreatedAt?: string;
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
