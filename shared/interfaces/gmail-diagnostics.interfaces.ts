import type { DiagnosticsStepStatus } from './microsoft365-diagnostics.interfaces';

export type { DiagnosticsStepStatus };

export interface GmailDiagnosticsError {
  message: string;
  code?: string;
  status?: number;
}

export interface GmailDiagnosticsStep {
  id: string;
  title: string;
  status: DiagnosticsStepStatus;
  startedAt: string;
  durationMs: number;
  /** What the administrator should do when this step is not a pass. */
  remediation?: string;
  data?: Record<string, unknown>;
  error?: GmailDiagnosticsError;
}

export interface GmailDiagnosticsSummary {
  providerId: string;
  tenantId: string;
  providerType: 'google';
  mailbox: string;
  projectId?: string;
  topicName?: string;
  subscriptionName?: string;
  /** Push endpoint and OIDC audience this instance expects, derived once. */
  expectedWebhookUrl?: string;
  /** Push endpoint Google is actually configured with, when it could be read. */
  actualPushEndpoint?: string;
  /** OIDC audience Google actually signs tokens with, when it could be read. */
  actualAudience?: string;
  watchExpiration?: string;
  lastPushReceivedAt?: string;
  overallStatus: DiagnosticsStepStatus;
}

export interface GmailDiagnosticsReport {
  createdAt: string;
  summary: GmailDiagnosticsSummary;
  steps: GmailDiagnosticsStep[];
  recommendations: string[];
  supportBundle: Record<string, unknown>;
}
