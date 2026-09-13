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
  mapOutboundRecommendations,
  normalizeOutboundGraphFailure,
  toDiagnosticsErrorMeta,
  type GraphFailure,
} from '@alga-psa/shared/services/email/microsoftGraphDiagnostics';
import {
  assembleDiagnosticsReport,
  runDiagnosticsSteps,
  type DiagnosticsStepDefinition,
} from '@alga-psa/shared/services/diagnostics/diagnosticsRunner';
import type { EmailProviderConfig as InboundEmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { TenantEmailService } from '../TenantEmailService';
import { resolveDefaultFromAddress, resolveTenantCompanyName } from '../senderIdentity';
import { EmailProviderManager } from '../providers/EmailProviderManager';
import { buildMicrosoftOutboundSteps } from './microsoftOutboundSteps';
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
      return { error: 'The selected Microsoft 365 mailbox has no OAuth configuration. Reconnect it before running diagnostics.' };
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
    error: result.error || 'The provider rejected the test message.',
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
    title: 'Outbound provider selected',
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
    title: 'Provider-specific diagnostics',
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
      return mapOutboundRecommendations({
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
        return ['The SMTP TLS handshake failed. Verify the certificate chain and TLS settings (including verify-certificate).'];
      }
      if (
        command === 'AUTH' ||
        code === 'EAUTH' ||
        responseCode === 535 ||
        /^\s*535\b/.test(response) ||
        /\bauthentication\b/i.test(response)
      ) {
        return ['SMTP authentication was rejected. Verify the username/password and that the relay permits AUTH.'];
      }
      if (
        ['ECONNECTION', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ESOCKET', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(code)
      ) {
        return ['The SMTP server could not be reached. Verify host, port, DNS, and firewall rules.'];
      }
      if (
        code === 'EENVELOPE' ||
        ['MAIL', 'RCPT', 'DATA', 'VRFY'].includes(command) ||
        (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600)
      ) {
        return [
          'The SMTP server rejected the recipient or message after connecting. Verify the recipient address and the sending account permissions, then retry.',
        ];
      }
      return ['The SMTP provider rejected the message. Review the native code/response above and retry after correcting the cause.'];
    }
    case 'resend':
      if (input.status === 401 || input.status === 403) {
        return ['Resend denied the send. Verify the API key scope and the verified sending domain, then retry.'];
      }
      if (input.status === 429) {
        return ['Resend throttled the send. Wait and retry; avoid repeated live sends.'];
      }
      return ['Resend rejected the message. Verify the API key, verified sending domain, and payload, then retry.'];
    default:
      return ['Review the provider error above and retry after correcting the cause.'];
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
    title: 'Live outbound send test',
    run: async (ctx) => {
      if (!ctx.options.liveSendTest) {
        return {
          status: 'skip',
          detail: 'Live send is off by default and was not requested.',
          data: { performed: false },
        };
      }
      if (!ctx.options.recipient) {
        return {
          status: 'fail',
          error: { message: 'A valid recipient is required when live send is enabled.' },
        };
      }
      if (!ctx.effectiveSender) {
        return {
          status: 'fail',
          error: { message: 'No effective sender could be resolved for the live send.' },
        };
      }

      const result = await ctx.liveSend({
        tenant: ctx.tenant,
        settings: ctx.settings,
        from: ctx.effectiveSender,
        fromName: ctx.effectiveSenderName ?? ctx.settings.ticketingFromName ?? undefined,
        recipient: ctx.options.recipient,
      });
      ctx.checkedCapabilities.push('live_send');

      if (result.success) {
        return {
          status: 'pass',
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

      const recommendations = liveSendRecommendations(ctx.provider.providerType, {
        status: result.status,
        errorCode: result.errorCode,
        message: result.error,
        responseCode: result.responseCode,
        command: result.command,
        response: result.response,
      });

      return {
        status: 'fail',
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
          message: result.error || 'Live send failed.',
          status: result.status,
          code: result.errorCode,
          requestId: result.requestId,
          clientRequestId: result.clientRequestId,
        },
        recommendations: recommendations.length
          ? recommendations
          : ['Review the provider error above and retry after correcting the cause.'],
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
    onError: (error) => {
      const failure = normalizeOutboundFailure(error, providerForContext.providerType);
      return {
        error: toDiagnosticsErrorMeta(failure),
        recommendations: liveSendRecommendations(providerForContext.providerType, {
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
      overallStatus: outcome.overallStatus,
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
