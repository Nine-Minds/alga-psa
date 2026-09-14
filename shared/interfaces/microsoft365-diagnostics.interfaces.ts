/**
 * Microsoft 365 diagnostics public types.
 *
 * The generic diagnostics kernel types are the source of truth; this module
 * preserves the existing Microsoft365-named aliases and exports so current
 * imports keep compiling.
 */

import type {
  DiagnosticsStep,
  DiagnosticsStepData,
  DiagnosticsStepStatus,
} from './diagnostics.interfaces';

export type {
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsStepStatus,
} from './diagnostics.interfaces';

export type Microsoft365DiagnosticsStep = DiagnosticsStep<DiagnosticsStepData> & {
  startedAt: string;
};

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
