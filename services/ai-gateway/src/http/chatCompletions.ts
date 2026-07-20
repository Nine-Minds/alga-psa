import { randomUUID } from 'node:crypto';
import { hrtime } from 'node:process';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Knex } from 'knex';

import { hasActiveConsent } from '../accounts/accountService.js';
import { checkAdmission, type AdmissionDenialReason } from '../ledger/admission.js';
import { debitUsage } from '../ledger/ledger.js';
import { calculateCredits, type DefaultPricingRate } from '../pricing/pricing.js';
import { resolvePricingRateFromDatabase } from '../pricing/repository.js';
import type { ProviderRouter } from '../providers/types.js';
import { getAuthenticatedContext } from './authMiddleware.js';
import { HttpError } from './errors.js';
import { readFeatureHeader } from './features.js';
import { readRequiredString, requireObject } from './input.js';
import { readUsageFromPayload, StreamingUsageCapture, type CapturedUsage } from './usageCapture.js';

export interface ChatCompletionsHandlerOptions {
  database: Knex;
  providerRouter: ProviderRouter;
  getDefaultPricingRate: () => DefaultPricingRate;
}

const ADMISSION_MESSAGES: Record<AdmissionDenialReason, string> = {
  no_subscription: 'An active AI add-on subscription is required.',
  out_of_credits: 'The AI credit balance and grace allowance are exhausted.',
  consent_required: 'Appliance data-sharing consent is required.',
};

function elapsedMilliseconds(startedAt: bigint): bigint {
  return (hrtime.bigint() - startedAt) / 1_000_000n;
}

function copyUpstreamResponseHeaders(upstream: globalThis.Response, response: Response): void {
  for (const name of [
    'content-type',
    'openai-processing-ms',
    'x-request-id',
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests',
  ]) {
    const value = upstream.headers.get(name);
    if (value) {
      response.setHeader(name, value);
    }
  }
}

async function throwProviderError(upstream: globalThis.Response): Promise<never> {
  await upstream.arrayBuffer().catch(() => undefined);
  const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
  throw new HttpError(status, 'provider_error', 'The upstream AI provider rejected the request.');
}

async function persistUsage(options: {
  database: Knex;
  accountId: string;
  feature: string;
  model: string;
  provider: string;
  usage: CapturedUsage;
  pricingRate: DefaultPricingRate;
  requestId: string;
  durationMs: bigint;
}): Promise<void> {
  const creditsCharged = calculateCredits(
    {
      promptTokens: options.usage.promptTokens,
      completionTokens: options.usage.completionTokens,
    },
    options.pricingRate,
  );
  if (creditsCharged <= 0n) {
    throw new HttpError(502, 'invalid_provider_usage', 'The upstream provider returned empty usage.');
  }

  await debitUsage(options.database, {
    accountId: options.accountId,
    feature: options.feature,
    model: options.model,
    provider: options.provider,
    promptTokens: options.usage.promptTokens,
    completionTokens: options.usage.completionTokens,
    totalTokens: options.usage.totalTokens,
    creditsCharged,
    requestId: options.requestId,
    durationMs: options.durationMs,
  });
}

async function proxyNonStreaming(options: {
  upstream: globalThis.Response;
  response: Response;
  database: Knex;
  accountId: string;
  feature: string;
  model: string;
  provider: string;
  pricingRate: DefaultPricingRate;
  requestId: string;
  startedAt: bigint;
}): Promise<void> {
  const responseText = await options.upstream.text();
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(responseText) as unknown;
  } catch {
    throw new HttpError(502, 'invalid_provider_response', 'The upstream provider returned invalid JSON.');
  }
  let usage: CapturedUsage | undefined;
  try {
    usage = readUsageFromPayload(responseBody);
  } catch (error) {
    throw new HttpError(
      502,
      'invalid_provider_usage',
      'The upstream provider returned invalid usage.',
      { cause: error },
    );
  }
  if (!usage) {
    throw new HttpError(502, 'missing_provider_usage', 'The upstream provider response omitted usage.');
  }

  await persistUsage({
    database: options.database,
    accountId: options.accountId,
    feature: options.feature,
    model: options.model,
    provider: options.provider,
    usage,
    pricingRate: options.pricingRate,
    requestId: options.requestId,
    durationMs: elapsedMilliseconds(options.startedAt),
  });

  copyUpstreamResponseHeaders(options.upstream, options.response);
  options.response.status(options.upstream.status).send(responseText);
}

async function proxyStreaming(options: {
  upstream: globalThis.Response;
  response: Response;
  database: Knex;
  accountId: string;
  feature: string;
  model: string;
  provider: string;
  pricingRate: DefaultPricingRate;
  requestId: string;
  startedAt: bigint;
}): Promise<void> {
  if (!options.upstream.body) {
    throw new HttpError(502, 'invalid_provider_response', 'The upstream stream has no response body.');
  }

  copyUpstreamResponseHeaders(options.upstream, options.response);
  options.response.status(options.upstream.status);
  options.response.flushHeaders();

  let clientConnected = !options.response.destroyed && !options.response.writableEnded;
  options.response.once('close', () => {
    clientConnected = false;
  });

  const usageCapture = new StreamingUsageCapture();
  const reader = options.upstream.body.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    usageCapture.push(result.value);
    if (clientConnected) {
      try {
        options.response.write(result.value);
      } catch {
        clientConnected = false;
      }
    }
  }

  const usage = usageCapture.finish();
  if (!usage) {
    throw new HttpError(
      502,
      'missing_provider_usage',
      'The upstream stream completed without a terminal usage chunk.',
    );
  }

  await persistUsage({
    database: options.database,
    accountId: options.accountId,
    feature: options.feature,
    model: options.model,
    provider: options.provider,
    usage,
    pricingRate: options.pricingRate,
    requestId: options.requestId,
    durationMs: elapsedMilliseconds(options.startedAt),
  });

  if (clientConnected) {
    options.response.end();
  }
}

export function createChatCompletionsHandler(
  options: ChatCompletionsHandlerOptions,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    void (async () => {
      const context = getAuthenticatedContext(response);
      const body = requireObject(request.body);
      const model = readRequiredString(body.model, 'model');
      if (body.stream !== undefined && typeof body.stream !== 'boolean') {
        throw new HttpError(400, 'invalid_request', 'stream must be a boolean');
      }
      let feature: string;
      try {
        feature = readFeatureHeader(request.get('x-alga-ai-feature'));
      } catch (error) {
        throw new HttpError(400, 'invalid_request', (error as Error).message);
      }

      const activeConsent =
        context.principal.deploymentType === 'hosted'
          ? true
          : await hasActiveConsent(options.database, context.account.account_id);
      const admission = checkAdmission(
        {
          subscriptionStatus: context.account.subscription_status,
          deploymentType: context.account.deployment_type,
          includedBalance: context.account.included_balance,
          topupBalance: context.account.topup_balance,
          graceLimitCredits: context.account.grace_limit_credits,
        },
        { hasActiveConsent: activeConsent },
      );
      if (!admission.allowed) {
        throw new HttpError(402, admission.reason, ADMISSION_MESSAGES[admission.reason]);
      }

      const requestId = request.get('x-request-id')?.trim() || randomUUID();
      const provider = options.providerRouter.resolve(model);
      const pricingRate = await resolvePricingRateFromDatabase(
        options.database,
        model,
        new Date(),
        options.getDefaultPricingRate(),
      );
      const stream = body.stream === true;
      const upstreamBody = stream
        ? {
            ...body,
            stream_options: {
              ...(typeof body.stream_options === 'object' &&
              body.stream_options !== null &&
              !Array.isArray(body.stream_options)
                ? body.stream_options
                : {}),
              include_usage: true,
            },
          }
        : body;
      const startedAt = hrtime.bigint();

      let upstream: globalThis.Response;
      try {
        upstream = await provider.createChatCompletion({
          body: upstreamBody,
          feature,
          requestId,
        });
      } catch (error) {
        throw new HttpError(502, 'provider_unavailable', 'The upstream AI provider is unavailable.', {
          cause: error,
        });
      }
      if (!upstream.ok) {
        await throwProviderError(upstream);
      }

      const common = {
        upstream,
        response,
        database: options.database,
        accountId: context.account.account_id,
        feature,
        model,
        provider: provider.id,
        pricingRate,
        requestId,
        startedAt,
      };
      if (stream) {
        await proxyStreaming(common);
      } else {
        await proxyNonStreaming(common);
      }
    })().catch(next);
  };
}
