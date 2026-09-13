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
  TenantEmailSettings,
} from '@alga-psa/types';
import { EmailProviderError } from '@alga-psa/types';
import {
  MicrosoftGraphAdapter,
} from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import {
  classifyGraphFailure,
  toDiagnosticsErrorMeta,
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
import { redactDiagnosticsValue } from './redaction';
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
      definitelyNotSent: error.metadata?.definitelyNotSent === true,
      requiresReconciliation: error.metadata?.requiresReconciliation === true,
      retryable: error.isRetryable,
      metadata: error.metadata,
    };
  }
  return { success: false, error: error instanceof Error ? error.message : fallback };
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
    if (result.success) {
      return { success: true, messageId: result.messageId, metadata: result.metadata };
    }
    return {
      success: false,
      error: result.error || 'The provider rejected the test message.',
      errorCode: metadataField(result.metadata, 'errorCode'),
      status: metadataNumber(result.metadata, 'status'),
      requestId: metadataField(result.metadata, 'requestId'),
      definitelyNotSent: result.metadata?.definitelyNotSent === true,
      requiresReconciliation: result.metadata?.requiresReconciliation === true,
      retryable: result.metadata?.retryable === true,
      metadata: result.metadata,
    };
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
        fromName: ctx.settings.ticketingFromName ?? undefined,
        recipient: ctx.options.recipient,
      });
      ctx.checkedCapabilities.push('live_send');

      if (result.success) {
        return {
          status: 'pass',
          data: {
            accepted: true,
            delivered: false,
            messageId: result.messageId ?? null,
            note: 'The provider accepted the message; acceptance is not delivery.',
          },
        };
      }

      return {
        status: 'fail',
        data: {
          definitelyNotSent: result.definitelyNotSent ?? null,
          requiresReconciliation: result.requiresReconciliation ?? null,
        },
        error: {
          message: result.error || 'Live send failed.',
          status: result.status,
          code: result.errorCode,
          requestId: result.requestId,
          clientRequestId: result.clientRequestId,
        },
        recommendations: [
          result.status === 403
            ? 'The provider denied the send. For Microsoft Graph, verify Mail.Send consent and Exchange Send As for the sending identity.'
            : 'Review the provider error above and retry after correcting the cause.',
        ],
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

  let ticketingFromEmail = settings?.ticketingFromEmail ?? undefined;
  let defaultFromEmail: string | undefined;
  if (settings) {
    try {
      const tenantCompanyName = await resolveTenantCompanyName(knex, tenant);
      defaultFromEmail = resolveDefaultFromAddress(settings, tenantCompanyName).email;
    } catch {
      defaultFromEmail = undefined;
    }
  }

  const effectiveSender = resolved
    ? resolved.providerType === 'microsoft'
      ? resolved.configuredMailbox
      : (resolved.rawConfig?.from as string | undefined) || ticketingFromEmail || defaultFromEmail
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
    onError: (error) => ({ error: toDiagnosticsErrorMeta(classifyGraphFailure(error)) }),
  });

  const liveSendStep = run.steps.find((step) => step.id === 'live_send_test');
  const liveSendPerformed = liveSendStep?.status === 'pass' || liveSendStep?.status === 'fail';

  const report = assembleDiagnosticsReport<
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
      authenticatedUserEmail: ctx.authenticatedUserEmail,
      mailboxBasePath: ctx.mailboxBasePath,
      checkedCapabilities: Array.from(new Set(ctx.checkedCapabilities)),
      liveSendRequested: options.liveSendTest,
      liveSendPerformed,
      overallStatus: outcome.overallStatus,
    }),
    buildSupportBundle: ({ run: outcome, summary }) => ({
      createdAt: outcome.createdAt,
      summary: redactDiagnosticsValue(summary, { includeIdentifiers: options.includeIdentifiers }),
      steps: redactDiagnosticsValue(outcome.steps, { includeIdentifiers: options.includeIdentifiers }),
      recommendations: redactDiagnosticsValue(outcome.recommendations, {
        includeIdentifiers: options.includeIdentifiers,
      }),
    }),
  });

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
