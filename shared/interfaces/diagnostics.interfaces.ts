/**
 * Domain-agnostic diagnostics types shared by the inbound Microsoft 365, Teams,
 * and outbound email diagnostics consumers.
 *
 * These types intentionally carry no domain-specific fields. Consumers either
 * use them directly or build a domain summary/support bundle around them.
 */

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

export type DiagnosticsStepData = Record<string, unknown>;

export interface DiagnosticsStep<TData extends DiagnosticsStepData = DiagnosticsStepData> {
  id: string;
  title: string;
  status: DiagnosticsStepStatus;
  /**
   * ISO timestamp captured before the step executes. Optional so consumers
   * whose legacy report omits it (Teams) can project it away.
   */
  startedAt?: string;
  durationMs: number;
  /** Domain-specific human summary. Present for Teams, absent for M365. */
  detail?: string;
  http?: DiagnosticsHttpMeta;
  data?: TData;
  error?: DiagnosticsErrorMeta;
}

export interface DiagnosticsReport<
  TSummary = Record<string, unknown>,
  TData extends DiagnosticsStepData = DiagnosticsStepData,
> {
  createdAt: string;
  summary: TSummary;
  steps: DiagnosticsStep<TData>[];
  recommendations: string[];
  supportBundle: Record<string, unknown>;
}
