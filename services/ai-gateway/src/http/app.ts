import process from 'node:process';

import express, { type Express, type RequestHandler } from 'express';
import type { Knex } from 'knex';

import type { GatewayAuthenticator } from '../auth/authenticator.js';
import { createGatewayAuthenticatorFromEnvironment } from '../auth/authenticator.js';
import { getDatabase } from '../db/client.js';
import {
  loadDefaultPricingRateFromEnvironment,
  type DefaultPricingRate,
} from '../pricing/pricing.js';
import { createProviderRouterFromEnvironment } from '../providers/router.js';
import type { ProviderRouter } from '../providers/types.js';
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
}

export function createApp(dependencies: GatewayAppDependencies = {}): Express {
  const app = express();
  const database = dependencies.database ?? getDatabase();
  const authenticator =
    dependencies.authenticator ?? createGatewayAuthenticatorFromEnvironment();
  const providerRouter = dependencies.providerRouter ?? createProviderRouterFromEnvironment();
  const getDefaultPricingRate = (): DefaultPricingRate =>
    dependencies.defaultPricingRate ?? loadDefaultPricingRateFromEnvironment();
  const accountHandlers = createAccountRouteHandlers(
    database,
    () => dependencies.adminToken ?? process.env.AI_GATEWAY_ADMIN_TOKEN ?? '',
  );
  const authenticate = createAuthenticationMiddleware(database, authenticator);
  const jsonBody = express.json({ limit: '2mb' });

  app.disable('x-powered-by');
  app.get('/healthz', healthzHandler);

  app.post(
    '/v1/chat/completions',
    authenticate,
    jsonBody,
    createChatCompletionsHandler({ database, providerRouter, getDefaultPricingRate }),
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
