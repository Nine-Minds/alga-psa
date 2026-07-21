import process from 'node:process';

import express, { type Express, type RequestHandler } from 'express';
import type { Knex } from 'knex';

import type { GatewayAuthenticator } from '../auth/authenticator.js';
import { createGatewayAuthenticatorFromEnvironment } from '../auth/authenticator.js';
import { createPostDebitHandler, type PostDebitHandler } from '../autoTopup/postDebit.js';
import { getDatabase } from '../db/client.js';
import {
  StructuredGatewayEventEmitter,
  type GatewayEventEmitter,
} from '../events/events.js';
import {
  loadDefaultPricingRateFromEnvironment,
  type DefaultPricingRate,
} from '../pricing/pricing.js';
import { createProviderRouterFromEnvironment } from '../providers/router.js';
import type { ProviderRouter } from '../providers/types.js';
import {
  OfficialGatewayStripeClient,
  type GatewayStripeClient,
} from '../stripe/stripeClient.js';
import { createStripeWebhookHandler } from '../stripe/webhook.js';
import { loadTierConfig, type TierConfigLoader } from '../tier/tierConfig.js';
import { createAccountRouteHandlers } from './accountRoutes.js';
import { createAuthenticationMiddleware } from './authMiddleware.js';
import { createChatCompletionsHandler } from './chatCompletions.js';
import { gatewayErrorHandler } from './errorHandler.js';

export const healthzHandler: RequestHandler = (_request, response) => {
  response.status(200).json({ status: 'ok' });
};

export interface GatewayAppDependencies {
  database?: Knex;
  authenticator?: GatewayAuthenticator;
  providerRouter?: ProviderRouter;
  defaultPricingRate?: DefaultPricingRate;
  adminToken?: string;
  stripe?: GatewayStripeClient;
  events?: GatewayEventEmitter;
  getTierConfig?: TierConfigLoader;
  afterDebit?: PostDebitHandler;
  stripeWebhookSecret?: string;
  autoTopupMaxAttempts?: number;
  autoTopupRetryBaseMs?: number;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function createApp(dependencies: GatewayAppDependencies = {}): Express {
  const app = express();
  const database = dependencies.database ?? getDatabase();
  const authenticator =
    dependencies.authenticator ?? createGatewayAuthenticatorFromEnvironment();
  const providerRouter = dependencies.providerRouter ?? createProviderRouterFromEnvironment();
  const getDefaultPricingRate = (): DefaultPricingRate =>
    dependencies.defaultPricingRate ?? loadDefaultPricingRateFromEnvironment();
  const stripe = dependencies.stripe ?? new OfficialGatewayStripeClient();
  const events = dependencies.events ?? new StructuredGatewayEventEmitter();
  const getTierConfig = dependencies.getTierConfig ?? (() => loadTierConfig(database));
  const afterDebit =
    dependencies.afterDebit ?? createPostDebitHandler({ database, getTierConfig, events });
  const accountHandlers = createAccountRouteHandlers(
    database,
    () => dependencies.adminToken ?? process.env.AI_GATEWAY_ADMIN_TOKEN ?? '',
    getTierConfig,
  );
  const authenticate = createAuthenticationMiddleware(database, authenticator, getTierConfig);
  const jsonBody = express.json({ limit: '2mb' });

  app.disable('x-powered-by');
  app.get('/healthz', healthzHandler);
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
    createStripeWebhookHandler({
      database,
      stripe,
      getTierConfig,
      events,
      getWebhookSecret: () =>
        dependencies.stripeWebhookSecret ??
        process.env.AI_GATEWAY_STRIPE_WEBHOOK_SECRET ??
        '',
      maxAutoTopupAttempts:
        dependencies.autoTopupMaxAttempts ??
        positiveInteger(
          process.env.AI_GATEWAY_AUTO_TOPUP_MAX_ATTEMPTS,
          3,
          'AI_GATEWAY_AUTO_TOPUP_MAX_ATTEMPTS',
        ),
      autoTopupRetryBaseMs:
        dependencies.autoTopupRetryBaseMs ??
        positiveInteger(
          process.env.AI_GATEWAY_AUTO_TOPUP_RETRY_BASE_MS,
          60_000,
          'AI_GATEWAY_AUTO_TOPUP_RETRY_BASE_MS',
        ),
    }),
  );

  app.post(
    '/v1/chat/completions',
    authenticate,
    jsonBody,
    createChatCompletionsHandler({
      database,
      providerRouter,
      getDefaultPricingRate,
      afterDebit,
    }),
  );
  app.get('/v1/account', authenticate, accountHandlers.getAccount);
  app.get('/v1/account/usage', authenticate, accountHandlers.getUsage);
  app.post('/v1/account/auto-topup', authenticate, jsonBody, accountHandlers.setAutoTopup);
  app.post('/v1/consent', authenticate, jsonBody, accountHandlers.grantConsent);
  app.delete('/v1/consent', authenticate, accountHandlers.revokeConsent);
  app.post(
    '/v1/admin/grants',
    accountHandlers.requireAdmin,
    jsonBody,
    accountHandlers.grantAdminCredits,
  );

  app.use(gatewayErrorHandler);

  return app;
}
