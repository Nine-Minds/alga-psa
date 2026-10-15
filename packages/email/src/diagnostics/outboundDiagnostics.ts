/**
 * Outbound email diagnostics orchestration.
 *
 * Resolves the saved tenant settings and the single enabled provider using the
 * same resolvers as real sending, dispatches provider-specific steps on the
 * shared diagnostics kernel, and optionally performs one live send through the
 * production provider manager.
 */

import type { Knex } from 'knex';
import type {
  EmailMessage,
  EmailSendResult,
  TenantEmailSettings,
} from '@alga-psa/types';
import { EmailProviderError } from '@alga-psa/types';
import {
  MicrosoftGraphAdapter,
} from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import {
  normalizeOutboundGraphFailure,
} from '@alga-psa/shared/services/email/microsoftGraphDiagnostics';
import {
  assembleDiagnosticsReport,
  computeOverallStatus,
  runDiagnosticsSteps,
  toDiagnosticsErrorMeta,
  type DiagnosticsStepDefinition,
  type GraphFailure,
} from '@alga-psa/shared/services/diagnostics';
import type { EmailProviderConfig as InboundEmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { TenantEmailService } from '../TenantEmailService';
import { resolveDefaultFromAddress, resolveTenantCompanyName } from '../senderIdentity';
import { EmailProviderManager } from '../providers/EmailProviderManager';
import { buildMicrosoftOutboundSteps, microsoftOutboundRecommendations } from './microsoftOutboundSteps';
import { buildSmtpOutboundSteps } from './smtpOutboundSteps';
import { buildResendOutboundSteps } from './resendOutboundSteps';
import {
  buildSanitizedSupportBundle,
  sanitizeDiagnosticsReport,
} from './redaction';
import type {
  NormalizedOutboundOptions,
  OutboundDiagnosticsContext,
  OutboundDiagnosticsDeps,
  OutboundDiagnosticsSummary,
  OutboundEmailDiagnosticsOptions,
  OutboundEmailDiagnosticsReport,
  OutboundLiveSend,
  OutboundLiveSendInput,
  OutboundLiveSendResult,
  OutboundProviderType,
  OutboundStepData,
  OutboundStepDefinition,
  ResolvedOutboundProvider,
} from './outboundTypes';

const OUTBOUND_PROVIDER_TYPES: OutboundProviderType[] = ['microsoft', 'smtp', 'resend'];

function normalizeOptions(options?: OutboundEmailDiagnosticsOptions): NormalizedOutboundOptions {
  const recipient = options?.recipient?.trim() || undefined;
  return {
    liveSendTest: options?.liveSendTest === true,
    includeIdentifiers: options?.includeIdentifiers === true,
    recipient,
  };
}

async function defaultResolveProvider(input: {
  tenant: string;
  knex: Knex;
  settings: TenantEmailSettings;
}): Promise<ResolvedOutboundProvider | { error: string }> {
  const { tenant, settings } = input;
  const enabled = settings.providerConfigs?.find((config) => config.isEnabled);
  if (!enabled) {
    return { error: 'No outbound email provider is enabled.' };
  }
  const providerType = enabled.providerType as OutboundProviderType;
  if (!OUTBOUND_PROVIDER_TYPES.includes(providerType)) {
    return { error: `Unsupported outbound provider type: ${String(enabled.providerType)}` };
  }

  // Resolve through the production manager so Microsoft mailbox binding and
  // Resend secret fallbacks behave exactly as they do for real sending.
  const manager = new EmailProviderManager();
  const resolvedConfig = await manager.resolveProviderConfig(tenant, enabled);

  if (providerType === 'microsoft') {
    const inboundProvider = resolvedConfig.inboundProvider as InboundEmailProviderConfig | undefined;
    if (!inboundProvider) {
      return { error: 'The selected Microsoft 365 mailbox is not connected. Reconnect it in email settings.' };
    }
    return {
      providerId: enabled.providerId,
      providerType: 'microsoft',
      providerName: inboundProvider.name,
      configuredMailbox: inboundProvider.mailbox,
      rawConfig: resolvedConfig,
      inboundProvider,
      adapter: new MicrosoftGraphAdapter(inboundProvider),
    };
  }

  return {
    providerId: enabled.providerId,
    providerType,
    providerName: typeof resolvedConfig.providerName === 'string' ? resolvedConfig.providerName : undefined,
    configuredMailbox: typeof resolvedConfig.from === 'string' ? resolvedConfig.from : undefined,
    rawConfig: resolvedConfig,
  };
}

function metadataField(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) ? value : undefined;
}

function toLiveSendFailure(error: unknown, fallback: string): OutboundLiveSendResult {
  if (error instanceof EmailProviderError) {
    return {
      success: false,
      error: error.message || fallback,
      errorCode: error.errorCode,
      status: metadataNumber(error.metadata, 'status'),
      requestId: metadataField(error.metadata, 'requestId'),
      clientRequestId: metadataField(error.metadata, 'clientRequestId'),
      responseCode: metadataNumber(error.metadata, 'responseCode'),
      command: metadataField(error.metadata, 'command'),
      response: metadataField(error.metadata, 'response'),
      definitelyNotSent: error.metadata?.definitelyNotSent === true,
      requiresReconciliation: error.metadata?.requiresReconciliation === true,
      retryable: error.isRetryable,
      metadata: error.metadata,
    };
  }
  return { success: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Project the production provider manager's `EmailSendResult` onto the
 * diagnostics live-send result, keeping every safe native protocol field
 * (status/responseCode/command/response and correlation ids). Exposed so tests
 * can run an actual provider wrapper through this boundary.
 */
export function liveSendResultFromEmailSendResult(result: EmailSendResult): OutboundLiveSendResult {
  if (result.success) {
    return {
      success: true,
      messageId: result.messageId,
      status: metadataNumber(result.metadata, 'status'),
      requestId: metadataField(result.metadata, 'requestId'),
      clientRequestId: metadataField(result.metadata, 'clientRequestId'),
      responseCode: metadataNumber(result.metadata, 'responseCode'),
      command: metadataField(result.metadata, 'command'),
      response: metadataField(result.metadata, 'response'),
      metadata: result.metadata,
    };
  }
  return {
    success: false,
    error: result.error || 'The email service did not confirm the test result.',
    errorCode: metadataField(result.metadata, 'errorCode'),
    status: metadataNumber(result.metadata, 'status'),
    requestId: metadataField(result.metadata, 'requestId'),
    clientRequestId: metadataField(result.metadata, 'clientRequestId'),
    responseCode: metadataNumber(result.metadata, 'responseCode'),
    command: metadataField(result.metadata, 'command'),
    response: metadataField(result.metadata, 'response'),
    definitelyNotSent: result.metadata?.definitelyNotSent === true,
    requiresReconciliation: result.metadata?.requiresReconciliation === true,
    retryable: result.metadata?.retryable === true,
    metadata: result.metadata,
  };
}

async function defaultSendLive(input: OutboundLiveSendInput): Promise<OutboundLiveSendResult> {
  const manager = new EmailProviderManager();
  try {
    await manager.initialize(input.settings);
  } catch (error) {
    return toLiveSendFailure(error, 'The outbound provider could not be initialized.');
  }

  const message: EmailMessage = {
    from: { email: input.from, ...(input.fromName ? { name: input.fromName } : {}) },
    to: [{ email: input.recipient }],
    subject: 'AlgaPSA outbound email diagnostics test',
    text: 'This is a diagnostics test message confirming the outbound email provider can send.',
    html: '<p>This is a diagnostics test message confirming the outbound email provider can send.</p>',
  };

  try {
    const result = await manager.sendEmail(message, input.tenant);
    return liveSendResultFromEmailSendResult(result);
  } catch (error) {
    return toLiveSendFailure(error, 'Failed to send the test message.');
  }
}

function buildSelectionStep(
  resolution: ResolvedOutboundProvider | { error: string },
  ctx: OutboundDiagnosticsContext,
): OutboundStepDefinition {
  return {
    id: 'outbound_provider_selected',
    title: 'Email service settings',
    run: async () => {
      if ('error' in resolution) {
        return {
          status: 'fail',
          error: { message: resolution.error },
          recommendations: ['Save and enable a valid outbound email provider before running diagnostics.'],
        };
      }
      return {
        status: 'pass',
        data: {
          providerId: resolution.providerId,
          providerType: resolution.providerType,
          providerName: resolution.providerName ?? null,
          configuredMailbox: resolution.configuredMailbox ?? null,
          ticketingFromEmail: ctx.ticketingFromEmail ?? null,
          defaultFromEmail: ctx.defaultFromEmail ?? null,
          effectiveSender: ctx.effectiveSender ?? null,
          effectiveSenderName: ctx.effectiveSenderName ?? null,
        },
      };
    },
  };
}

function buildDependentSkipStep(reason: string): OutboundStepDefinition {
  return {
    id: 'outbound_provider_steps',
    title: 'Connection checks',
    run: async () => ({
      status: 'skip',
      detail: `Skipped: ${reason}`,
      data: { reason },
    }),
  };
}

/**
 * Provider-specific remediation for a failed live send. Graph advice must not be
 * shown for SMTP or Resend failures.
 *
 * SMTP classification uses only native protocol evidence — errorCode, command,
 * responseCode and the sanitized server response — never the provider's generic
 * remediation message (which always mentions "credentials" and would otherwise
 * mislabel every failure as an AUTH problem).
 */
function liveSendRecommendations(
  providerType: OutboundProviderType,
  input: {
    status?: number;
    errorCode?: string;
    message?: string;
    responseCode?: number;
    command?: string;
    response?: string;
    sharedMailbox?: boolean;
  },
): string[] {
  switch (providerType) {
    case 'microsoft':
      return microsoftOutboundRecommendations({
        status: input.status,
        code: input.errorCode,
        message: input.message || '',
        sharedMailbox: input.sharedMailbox,
      });
    case 'smtp': {
      const code = (input.errorCode || '').toUpperCase();
      const command = (input.command || '').toUpperCase();
      const responseCode = input.responseCode ?? input.status;
      const response = input.response || '';

      if (code === 'ETLS' || /certificate|self[- ]signed|\btls\b|\bssl\b/i.test(response)) {
        return ['AlgaPSA could not establish a secure connection to the mail server. Check the encryption settings and ask your mail administrator to check the server certificate.'];
      }
      if (
        command === 'AUTH' ||
        code === 'EAUTH' ||
        responseCode === 535 ||
        /^\s*535\b/.test(response) ||
        /\bauthentication\b/i.test(response)
      ) {
        return ['The mail server rejected the sign-in. Check the username and password, and confirm this account is allowed to send through this server.'];
      }
      if (
        ['ECONNECTION', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ESOCKET', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(code)
      ) {
        return ['AlgaPSA could not reach the mail server. Check SMTP Host and Port. If they are correct, ask your network administrator to check access to the server.'];
      }
      if (
        code === 'EENVELOPE' ||
        ['MAIL', 'RCPT', 'DATA', 'VRFY'].includes(command) ||
        (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600)
      ) {
        return [
          'The mail server rejected the recipient or message. Check the recipient address and confirm this account is allowed to send from the configured address.',
        ];
      }
      return ['Ask your mail administrator to review the technical details, or share the support report with AlgaPSA support.'];
    }
    case 'resend':
      if (input.status === 401 || input.status === 403) {
        return ['Check that the API key allows sending and that the sender’s domain is verified in Resend.'];
      }
      if (input.status === 429) {
        return ['Resend is receiving too many requests. Wait a few minutes before trying again.'];
      }
      return ['Check the API key and sending domain in Resend. If the problem continues, share the support report with AlgaPSA support.'];
    default:
      return ['The email service could not complete the check. Share the support report with AlgaPSA support if the problem continues.'];
  }
}

/**
 * Normalize a thrown outbound failure without assuming Graph. Microsoft keeps
 * the shared Graph classifier; other providers read `EmailProviderError`'s
 * errorCode/metadata and native protocol fields.
 */
interface OutboundFailure extends GraphFailure {
  responseCode?: number;
  command?: string;
  response?: string;
}

function normalizeOutboundFailure(error: unknown, providerType: OutboundProviderType): OutboundFailure {
  if (providerType === 'microsoft') {
    return normalizeOutboundGraphFailure(error);
  }
  const e = error as any;
  const metadata = (e?.metadata ?? {}) as Record<string, unknown>;
  const rawStatus = e?.status ?? e?.response?.status ?? metadata.status;
  const status = Number.isFinite(Number(rawStatus)) ? Number(rawStatus) : undefined;
  const code =
    (typeof e?.errorCode === 'string' ? e.errorCode : undefined) ??
    (typeof metadata.errorCode === 'string' ? metadata.errorCode : undefined) ??
    (typeof e?.code === 'string' ? e.code : undefined) ??
    (status ? String(status) : undefined);
  const message = e instanceof Error ? e.message : typeof error === 'string' ? error : 'Unknown error';
  const requestId =
    (typeof e?.requestId === 'string' ? e.requestId : undefined) ??
    (typeof metadata.requestId === 'string' ? metadata.requestId : undefined);
  const clientRequestId =
    (typeof e?.clientRequestId === 'string' ? e.clientRequestId : undefined) ??
    (typeof metadata.clientRequestId === 'string' ? metadata.clientRequestId : undefined);
  const rawResponseCode = e?.responseCode ?? metadata.responseCode;
  const responseCode = Number.isFinite(Number(rawResponseCode)) ? Number(rawResponseCode) : undefined;
  const command =
    (typeof e?.command === 'string' ? e.command : undefined) ??
    (typeof metadata.command === 'string' ? metadata.command : undefined);
  const response =
    (typeof e?.response === 'string' ? e.response : undefined) ??
    (typeof metadata.response === 'string' ? metadata.response : undefined);
  return { status, code, message, requestId, clientRequestId, responseCode, command, response };
}

function buildLiveSendStep(): OutboundStepDefinition {
  return {
    id: 'live_send_test',
    title: 'Test email',
    run: async (ctx) => {
      if (!ctx.options.liveSendTest) {
        return {
          status: 'skip',
          detail: 'No test email has been sent.',
          data: { performed: false },
        };
      }
      if (!ctx.options.recipient) {
        return {
          status: 'fail',
          error: { message: 'Enter a valid recipient email address to send a test email.' },
        };
      }
      if (!ctx.effectiveSender) {
        return {
          status: 'fail',
          error: { message: 'No sending address is configured. Save a From Address in email settings before sending a test email.' },
        };
      }

      let result: OutboundLiveSendResult;
      try {
        result = await ctx.liveSend({
          tenant: ctx.tenant,
          settings: ctx.settings,
          from: ctx.effectiveSender,
          fromName: ctx.effectiveSenderName ?? ctx.settings.ticketingFromName ?? undefined,
          recipient: ctx.options.recipient,
        });
      } catch (error) {
        result = toLiveSendFailure(error, 'The email service did not confirm the test result.');
      }
      ctx.checkedCapabilities.push('live_send');

      if (result.success) {
        return {
          status: 'pass',
          detail: 'The email service accepted the test email. Check the recipient’s inbox and spam folder to confirm delivery.',
          http: {
            method: 'POST',
            ...(result.status !== undefined ? { status: result.status } : {}),
            ...(result.requestId ? { requestId: result.requestId } : {}),
            ...(result.clientRequestId ? { clientRequestId: result.clientRequestId } : {}),
          },
          data: {
            accepted: true,
            delivered: false,
            messageId: result.messageId ?? null,
            status: result.status ?? null,
            requestId: result.requestId ?? null,
            clientRequestId: result.clientRequestId ?? null,
            responseCode: result.responseCode ?? null,
            command: result.command ?? null,
            response: result.response ?? null,
            note: 'The provider accepted the message; acceptance is not delivery.',
          },
        };
      }

      const rejectionConfirmed = result.definitelyNotSent === true ||
        (typeof result.status === 'number' && result.status >= 400 && result.status < 500 && result.status !== 408) ||
        (typeof result.responseCode === 'number' && result.responseCode >= 400 && result.responseCode < 600);
      const sendResultUnknown = result.requiresReconciliation === true || !rejectionConfirmed;
      const providerRecommendations = liveSendRecommendations(ctx.provider.providerType, {
        status: result.status,
        errorCode: result.errorCode,
        message: result.error,
        responseCode: result.responseCode,
        command: result.command,
        response: result.response,
      });
      const recommendations = sendResultUnknown
        ? ['The email service did not confirm the result. Check the recipient’s inbox and spam folder before sending another test email.', ...providerRecommendations]
        : providerRecommendations;

      return {
        status: 'fail',
        detail: sendResultUnknown
          ? 'The email service did not confirm whether the test email was sent.'
          : 'The test email could not be sent.',
        http: {
          method: 'POST',
          ...(result.status !== undefined ? { status: result.status } : {}),
          ...(result.requestId ? { requestId: result.requestId } : {}),
          ...(result.clientRequestId ? { clientRequestId: result.clientRequestId } : {}),
        },
        data: {
          definitelyNotSent: result.definitelyNotSent ?? null,
          requiresReconciliation: result.requiresReconciliation ?? null,
          status: result.status ?? null,
          requestId: result.requestId ?? null,
          clientRequestId: result.clientRequestId ?? null,
          errorCode: result.errorCode ?? null,
          responseCode: result.responseCode ?? null,
          command: result.command ?? null,
          response: result.response ?? null,
        },
        error: {
          message: result.error || 'The test email could not be sent.',
          status: result.status,
          code: result.errorCode,
          requestId: result.requestId,
          clientRequestId: result.clientRequestId,
        },
        recommendations: recommendations.length
          ? recommendations
          : ['The email service could not complete the check. Share the support report with AlgaPSA support if the problem continues.'],
      };
    },
  };
}

function providerStepsFor(providerType: OutboundProviderType): OutboundStepDefinition[] {
  switch (providerType) {
    case 'microsoft':
      return buildMicrosoftOutboundSteps();
    case 'smtp':
      return buildSmtpOutboundSteps();
    case 'resend':
      return buildResendOutboundSteps();
    default:
      return [];
  }
}

export interface RunOutboundDiagnosticsWithSettingsParams {
  tenant: string;
  knex: Knex;
  settings: TenantEmailSettings | null;
  options?: OutboundEmailDiagnosticsOptions;
  deps?: OutboundDiagnosticsDeps;
}

export async function runOutboundEmailDiagnosticsWithSettings(
  params: RunOutboundDiagnosticsWithSettingsParams,
): Promise<OutboundEmailDiagnosticsReport> {
  const { tenant, knex, settings } = params;
  const options = normalizeOptions(params.options);
  const resolveProvider = params.deps?.resolveProvider ?? defaultResolveProvider;
  const sendLive: OutboundLiveSend = params.deps?.sendLive ?? defaultSendLive;

  let resolution: ResolvedOutboundProvider | { error: string };
  if (!settings) {
    resolution = { error: 'No outbound email settings are configured.' };
  } else {
    try {
      resolution = await resolveProvider({ tenant, knex, settings });
    } catch (error) {
      resolution = {
        error: error instanceof Error ? error.message : 'Failed to resolve the outbound provider.',
      };
    }
  }
  const resolved = 'error' in resolution ? null : resolution;
  const resolutionError = 'error' in resolution ? resolution.error : null;

  const ticketingFromEmail = settings?.ticketingFromEmail ?? undefined;
  let tenantCompanyName: string | null = null;
  if (settings) {
    try {
      tenantCompanyName = await resolveTenantCompanyName(knex, tenant);
    } catch {
      tenantCompanyName = null;
    }
  }
  // Reuse the production sender resolution (the same helper the real test send
  // uses) so diagnostics test the same From: provider From, defaultFromDomain
  // rewrite, address parsing and resolved display name. Microsoft always sends
  // as its bound mailbox, which the resolver's provider From normally mirrors.
  const resolvedDefaultFrom = settings
    ? resolveDefaultFromAddress(settings, tenantCompanyName)
    : undefined;
  const defaultFromEmail = resolvedDefaultFrom?.email;
  const effectiveSenderName = resolvedDefaultFrom?.name;

  const effectiveSender = resolved
    ? resolved.providerType === 'microsoft'
      ? resolved.configuredMailbox || resolvedDefaultFrom?.email
      : resolvedDefaultFrom?.email
    : undefined;

  const providerForContext: ResolvedOutboundProvider = resolved ?? {
    providerId: '',
    providerType: (settings?.emailProvider as OutboundProviderType) ?? 'smtp',
    rawConfig: {},
  };

  const ctx: OutboundDiagnosticsContext = {
    tenant,
    knex,
    settings: settings as TenantEmailSettings,
    options,
    ticketingFromEmail,
    defaultFromEmail,
    provider: providerForContext,
    effectiveSender,
    effectiveSenderName,
    liveSend: sendLive,
    checkedCapabilities: [],
  };

  if (resolved?.providerType === 'microsoft' && resolved.adapter) {
    try {
      const identity = await resolved.adapter.fetchAuthenticatedIdentity();
      ctx.identityPreflight = {
        ok: true,
        email: identity.email,
        data: identity.data,
        http: identity.http,
      };
      ctx.authenticatedUserEmail = identity.email;
    } catch (error) {
      ctx.identityPreflight = { ok: false, error };
    }
  }

  const steps: OutboundStepDefinition[] = [buildSelectionStep(resolution, ctx)];
  if (resolved) {
    steps.push(...providerStepsFor(resolved.providerType));
    steps.push(buildLiveSendStep());
  } else {
    steps.push(buildDependentSkipStep(resolutionError ?? 'No outbound email provider is available.'));
  }

  const run = await runDiagnosticsSteps<OutboundDiagnosticsContext, OutboundStepData>({
    context: ctx,
    steps,
    onError: (error, step) => {
      const failure = normalizeOutboundFailure(error, providerForContext.providerType);
      return {
        error: toDiagnosticsErrorMeta(failure),
        recommendations: step.id === 'graph_me'
          ? ['The connected Microsoft account could not be checked. Reconnect the mailbox in email settings and run checks again.']
          : liveSendRecommendations(providerForContext.providerType, {
              status: failure.status,
              errorCode: failure.code,
              message: failure.message,
              responseCode: failure.responseCode,
              command: failure.command,
              response: failure.response,
            }),
      };
    },
  });

  // Provider errors remain available for support; their raw protocol messages
  // must not be the administrator’s only explanation of a failed request.
  const requestFailureDetails: Record<string, string> = {
    tokens_present: 'The Microsoft 365 connection could not be checked.',
    token_claims: 'Email permissions could not be checked.',
    graph_me: 'The connected Microsoft account could not be checked.',
    mailbox_base_path: 'The sending mailbox could not be checked.',
    smtp_connection: 'The mail server connection could not be checked.',
    resend_domains_check: 'The Resend connection could not be checked.',
    live_send_test: 'The test email could not be sent.',
  };
  for (const step of run.steps) {
    if (step.error && !step.detail && requestFailureDetails[step.id]) {
      step.detail = requestFailureDetails[step.id];
    }
  }

  const liveSendStep = run.steps.find((step) => step.id === 'live_send_test');
  const liveSendPerformed = liveSendStep?.status === 'pass' || liveSendStep?.status === 'fail';

  const rawReport = assembleDiagnosticsReport<
    OutboundDiagnosticsContext,
    OutboundStepData,
    OutboundDiagnosticsSummary
  >({
    run,
    context: ctx,
    buildSummary: ({ run: outcome }) => ({
      providerId: resolved?.providerId ?? '',
      providerType: resolved?.providerType ?? providerForContext.providerType,
      configuredMailbox: resolved?.configuredMailbox,
      ticketingFromEmail,
      defaultFromEmail,
      effectiveSender,
      effectiveSenderName,
      authenticatedUserEmail: ctx.authenticatedUserEmail,
      mailboxBasePath: ctx.mailboxBasePath,
      checkedCapabilities: Array.from(new Set(ctx.checkedCapabilities)),
      liveSendRequested: options.liveSendTest,
      liveSendPerformed,
      // Unresolved checks (unverified Send As/Sent Items, undecodable scopes,
      // restricted Resend keys) stay visible and drive a warning headline rather
      // than being hidden as a false pass.
      overallStatus: computeOverallStatus(outcome.steps),
    }),
    buildSupportBundle: () => ({}),
  });

  // The action report keeps operational identities visible to the authorized
  // admin, but always scrubs secrets and drops raw provider response bodies. The
  // export honors the explicit includeIdentifiers option.
  const report: OutboundEmailDiagnosticsReport = {
    ...sanitizeDiagnosticsReport(rawReport, { includeIdentifiers: true }),
    supportBundle: buildSanitizedSupportBundle(rawReport, {
      includeIdentifiers: options.includeIdentifiers,
    }),
  };

  return report;
}

export async function runOutboundEmailDiagnostics(params: {
  tenant: string;
  knex: Knex;
  options?: OutboundEmailDiagnosticsOptions;
  deps?: OutboundDiagnosticsDeps;
}): Promise<OutboundEmailDiagnosticsReport> {
  const settings = await TenantEmailService.getTenantEmailSettings(params.tenant, params.knex);
  return runOutboundEmailDiagnosticsWithSettings({
    tenant: params.tenant,
    knex: params.knex,
    settings,
    options: params.options,
    deps: params.deps,
  });
}

export type {
  OutboundEmailDiagnosticsOptions,
  OutboundEmailDiagnosticsReport,
} from './outboundTypes';
