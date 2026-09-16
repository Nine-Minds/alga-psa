import type {
  DiagnosticsAction,
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsRecommendation,
  DiagnosticsStep,
  DiagnosticsStepStatus,
} from './diagnostics.interfaces';

export type EntraDiagnosticsScope = 'connection' | 'clients';

export type EntraConnectionType = 'direct' | 'cipp';

/** Deterministic aggregate bucket for a completed client result. */
export type EntraClientOutcomeCategory =
  | 'ok'
  | 'need_consent'
  | 'conditional_access'
  | 'missing_role'
  | 'other';

/**
 * A diagnostics step enriched with Entra-specific structured recommendations
 * and dependency skips. The generic fields keep the shared runner usable.
 */
export interface EntraDiagnosticsStep extends DiagnosticsStep {
  recommendations?: DiagnosticsRecommendation[];
}

export interface EntraDiagnosticsSummary {
  connectionType: EntraConnectionType | null;
  connectionStatus: string | null;
  profileName: string | null;
  partnerTenantId: string | null;
  authenticatedUpn: string | null;
  tokenExpiresAt: string | null;
  managedTenantCount: number | null;
  mappedClientCount: number | null;
  overallStatus: DiagnosticsStepStatus;
}

export interface EntraClientDiagnosticsResult {
  clientId: string;
  clientName: string | null;
  entraTenantId: string | null;
  entraTenantDisplayName: string | null;
  overallStatus: DiagnosticsStepStatus;
  category: EntraClientOutcomeCategory;
  remedy: string | null;
  steps: EntraDiagnosticsStep[];
  /** False when the client's steps were cut short (e.g. job budget hit). */
  isComplete: boolean;
}

export interface EntraDiagnosticsSupportBundle {
  createdAt: string;
  scope: EntraDiagnosticsScope;
  connectionType: EntraConnectionType | null;
  summary: EntraDiagnosticsSummary;
  steps: EntraDiagnosticsStep[];
  clients: EntraClientDiagnosticsResult[];
  recommendations: DiagnosticsRecommendation[];
}

export interface EntraDiagnosticsReport {
  createdAt: string;
  scope: EntraDiagnosticsScope;
  summary: EntraDiagnosticsSummary;
  steps: EntraDiagnosticsStep[];
  clients: EntraClientDiagnosticsResult[];
  recommendations: DiagnosticsRecommendation[];
  supportBundle: EntraDiagnosticsSupportBundle | Record<string, unknown>;
}

export interface EntraDiagnosticsReadinessCheck {
  key: string;
  ok: boolean;
  detail?: string | null;
}

export interface EntraDiagnosticsReadiness {
  authenticated: boolean;
  clientPortal: boolean;
  edition: 'enterprise' | 'community';
  checks: EntraDiagnosticsReadinessCheck[];
  ok: boolean;
  deniedReason: string | null;
}

export interface EntraConnectionDiagnosticsOptions {
  includeIdentifiers?: boolean;
  readiness?: EntraDiagnosticsReadiness;
}

export interface EntraClientAccessDiagnosticsInput {
  /**
   * Confirmed mapping client ids to inspect. Omitted selects every confirmed
   * mapping; an explicit empty array selects none.
   */
  clientIds?: string[];
  includeUserYield?: boolean;
}

/**
 * Bounded, request-driven continuation response for client diagnostics. A
 * start call returns a continuation id plus the total count; each continuation
 * executes a bounded batch and returns completed sub-reports.
 */
export interface EntraClientDiagnosticsContinuation {
  jobId: string;
  scope: 'clients';
  total: number;
  completed: number;
  isDone: boolean;
  /** ISO timestamp after which the continuation is rejected. */
  expiresAt: string;
  clients: EntraClientDiagnosticsResult[];
  aggregate: Record<EntraClientOutcomeCategory, number>;
  overallStatus: DiagnosticsStepStatus;
  /** Present when the whole run could not start (e.g. no connection). */
  error?: string;
  steps: EntraDiagnosticsStep[];
  recommendations: DiagnosticsRecommendation[];
}

export interface EntraDiagnosticsActionEnvelope {
  success: boolean;
  data?: EntraDiagnosticsReport | EntraClientDiagnosticsContinuation;
  error?: string;
}

export interface EntraDiagnosticsRedactionOptions {
  includeIdentifiers?: boolean;
}

export type {
  DiagnosticsAction,
  DiagnosticsErrorMeta,
  DiagnosticsHttpMeta,
  DiagnosticsRecommendation,
  DiagnosticsStepStatus,
};
