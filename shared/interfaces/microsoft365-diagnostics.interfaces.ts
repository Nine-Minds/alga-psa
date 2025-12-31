export type DiagnosticsStepStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface DiagnosticsHttpMeta {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url?: string;
  path?: string;
  resource?: string;
  status?: number;
  requestId?: string;
  clientRequestId?: string;
}

export interface DiagnosticsErrorMeta {
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
  clientRequestId?: string;
  responseBody?: unknown;
}

export interface Microsoft365DiagnosticsStep {
  id: string;
  title: string;
  status: DiagnosticsStepStatus;
  startedAt: string;
  durationMs: number;
  http?: DiagnosticsHttpMeta;
  data?: Record<string, unknown>;
  error?: DiagnosticsErrorMeta;
}

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

