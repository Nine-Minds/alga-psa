/**
 * Generic, provider-neutral diagnostics primitives.
 *
 * These types are shared by the Microsoft 365 email diagnostics engine and the
 * Entra connection/client diagnostics engine. Keep them free of any provider
 * or edition specific concepts so both can consume them.
 */

export type DiagnosticsStepStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type DiagnosticsSeverity = 'fail' | 'warn' | 'info';

export interface DiagnosticsHttpMeta {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
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
  graphCode?: string;
  oauthError?: string;
  suberror?: string;
  aadstsCode?: string;
  requestId?: string;
  clientRequestId?: string;
  responseBody?: unknown;
}

/** Extensible per-step data payload shared by every diagnostics consumer. */
export type DiagnosticsStepData = Record<string, unknown>;

/**
 * A single diagnostics step. `id` and `title` are assigned by the runner; the
 * callable returns the partial fields a step is responsible for.
 */
export interface DiagnosticsStep<TData extends DiagnosticsStepData = DiagnosticsStepData> {
  id: string;
  title: string;
  status: DiagnosticsStepStatus;
  startedAt: string;
  durationMs: number;
  /** Optional human summary. Teams projects this as its required `detail`. */
  detail?: string;
  http?: DiagnosticsHttpMeta;
  data?: TData;
  error?: DiagnosticsErrorMeta;
  /** Stable id of the prerequisite whose failure caused this step to skip. */
  blockedBy?: string;
}

/** The subset of a step a step function may return. */
export type DiagnosticsStepResult<TData extends DiagnosticsStepData = DiagnosticsStepData> = Pick<
  DiagnosticsStep<TData>,
  'status' | 'detail' | 'http' | 'data' | 'error'
>;

/**
 * Canonical report envelope. Consumers project domain summaries into
 * `TSummary` and step data into `TData`; the execution kernel owns the rest.
 */
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

/**
 * Result of classifying an arbitrary thrown error into safe diagnostics
 * metadata. `recommendations` are domain-specific strings the caller may map.
 */
export interface ClassifiedDiagnosticsError {
  error: DiagnosticsErrorMeta;
  recommendations?: string[];
}

/** Structured recommendation emitted into an Entra report. */
export interface DiagnosticsRecommendation {
  /** Stable code used for deduplication and localization. */
  code: string;
  severity: DiagnosticsSeverity;
  /** English fallback text; the UI prefers the localization key. */
  text: string;
  /** Optional localization key under `integrations.entra.diagnostics.remedies.*`. */
  messageKey?: string;
  /** Optional interpolation parameters for the localization key. */
  params?: Record<string, string | number>;
  /** Optional operator action. */
  action?: DiagnosticsAction;
}

export interface DiagnosticsAction {
  kind: 'copy' | 'open_url' | 'navigate';
  payload: string;
}
