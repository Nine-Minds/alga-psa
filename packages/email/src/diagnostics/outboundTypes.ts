/**
 * Outbound email diagnostics types.
 *
 * The execution/report plumbing comes from the shared diagnostics kernel; these
 * types describe the outbound-specific provider selection and summary.
 */

import type { Knex } from 'knex';
import type {
  DiagnosticsHttpMeta,
  DiagnosticsStep,
  DiagnosticsStepData,
  DiagnosticsStepStatus,
} from '@alga-psa/shared/interfaces/diagnostics.interfaces';
import type {
  DiagnosticsStepDefinition,
} from '@alga-psa/shared/services/diagnostics/diagnosticsRunner';
import type { TenantEmailSettings } from '@alga-psa/types';
import type { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import type { EmailProviderConfig as InboundEmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

export type OutboundProviderType = 'microsoft' | 'smtp' | 'resend';

export type OutboundStepData = Record<string, unknown>;

export interface OutboundEmailDiagnosticsOptions {
  liveSendTest?: boolean;
  recipient?: string;
  includeIdentifiers?: boolean;
}

export interface ResolvedOutboundProvider {
  providerId: string;
  providerType: OutboundProviderType;
  providerName?: string;
  configuredMailbox?: string;
  rawConfig: Record<string, any>;
  inboundProvider?: InboundEmailProviderConfig;
  adapter?: MicrosoftGraphAdapter;
}

export interface NormalizedOutboundOptions {
  liveSendTest: boolean;
  includeIdentifiers: boolean;
  recipient?: string;
}

export interface OutboundLiveSendInput {
  tenant: string;
  settings: TenantEmailSettings;
  from: string;
  fromName?: string;
  recipient: string;
}

export interface OutboundLiveSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  status?: number;
  requestId?: string;
  clientRequestId?: string;
  /** Native SMTP response code / provider protocol status when distinct from HTTP status. */
  responseCode?: number;
  /** Native SMTP command that failed (e.g. AUTH, RCPT). */
  command?: string;
  /** Native SMTP/provider response text. */
  response?: string;
  definitelyNotSent?: boolean;
  requiresReconciliation?: boolean;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
}

export type OutboundLiveSend = (
  input: OutboundLiveSendInput,
) => Promise<OutboundLiveSendResult>;

export interface OutboundDiagnosticsContext {
  tenant: string;
  knex: Knex;
  settings: TenantEmailSettings;
  options: NormalizedOutboundOptions;
  ticketingFromEmail?: string;
  defaultFromEmail?: string;
  provider: ResolvedOutboundProvider;
  effectiveSender?: string;
  /** Display name paired with effectiveSender by the production sender resolver. */
  effectiveSenderName?: string;
  authenticatedUserEmail?: string;
  mailboxBasePath?: string;
  liveSend: OutboundLiveSend;
  checkedCapabilities: string[];
  /**
   * Identity preflight captured before steps run so token_claims can make the
   * shared-mailbox scope decision without a duplicate /me call.
   */
  identityPreflight?:
    | { ok: true; email?: string; data: Record<string, unknown>; http: DiagnosticsHttpMeta; error?: undefined }
    | { ok: false; error: unknown };
}

export type OutboundStepDefinition = DiagnosticsStepDefinition<
  OutboundDiagnosticsContext,
  OutboundStepData
>;

export type OutboundStep = DiagnosticsStep<OutboundStepData>;

/** Checks that provide context but cannot establish a sending failure. */
export function isAdvisoryOutboundStep(step: Pick<OutboundStep, 'id' | 'status' | 'data'>): boolean {
  if (step.id === 'sent_items_writable') return true;
  if (step.status !== 'warn') return false;
  if (step.id === 'token_claims') {
    return step.data?.decoded === false || step.data?.scopesAvailable === false;
  }
  return step.id === 'resend_domains_check' && step.data?.denied === true;
}


export interface OutboundDiagnosticsSummary {
  providerId: string;
  providerType: OutboundProviderType;
  configuredMailbox?: string;
  ticketingFromEmail?: string;
  defaultFromEmail?: string;
  effectiveSender?: string;
  effectiveSenderName?: string;
  authenticatedUserEmail?: string;
  mailboxBasePath?: string;
  checkedCapabilities: string[];
  liveSendRequested: boolean;
  liveSendPerformed: boolean;
  overallStatus: DiagnosticsStepStatus;
}

export interface OutboundEmailDiagnosticsReport {
  createdAt: string;
  summary: OutboundDiagnosticsSummary;
  steps: OutboundStep[];
  recommendations: string[];
  supportBundle: Record<string, unknown>;
}

export interface OutboundDiagnosticsDeps {
  /** Resolve the enabled provider. Injectable for tests. */
  resolveProvider?: (input: {
    tenant: string;
    knex: Knex;
    settings: TenantEmailSettings;
  }) => Promise<ResolvedOutboundProvider | { error: string }>;
  /** Live send through the production provider manager. Injectable for tests. */
  sendLive?: OutboundLiveSend;
}
