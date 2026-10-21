'use server';

/**
 * Server actions backing the AI Usage billing UI.
 *
 * These implement the frozen `AiUsageActions` contract from
 * `ee/server/src/lib/aiGateway/types.ts`. Every action threads the current
 * tenant from the session context (never from the client) and delegates to the
 * AI gateway client / checkout libs, mirroring the auth + tenant-context idiom
 * used by sibling billing actions (see `license-actions.ts`).
 */

import { getSession } from '@alga-psa/auth';
import { checkAccountManagementPermission } from '@alga-psa/auth/actions';
import logger from '@alga-psa/core/logger';
import type {
  AiAccountSummary,
  AiAutoTopupSettings,
  AiGatewayResult,
  AiGatewayUnavailable,
  AiUsageActions,
  AiUsagePage,
  AiUsageQuery,
} from '../aiGateway/types';
import {
  aiGatewayFetchAccount,
  aiGatewayFetchUsage,
  aiGatewaySetAutoTopup,
  isAiGatewayConfigured,
} from '../aiGateway/client';
import {
  createAiAddonCheckoutSession,
  createAiTopupCheckoutSession,
} from '../aiGateway/checkout';

/**
 * Resolve the tenant from the session. Reads (account summary, usage history)
 * are available to any authenticated tenant user so the chat header indicator
 * and settings section can both render.
 */
async function requireTenant(): Promise<string> {
  const session = await getSession();
  if (!session?.user?.tenant) {
    throw new Error('Not authenticated');
  }
  return session.user.tenant;
}

/**
 * Resolve the tenant and assert billing-management permission. Used by the
 * mutating actions (auto-top-up, checkout) which change money-critical state.
 */
async function requireBillingTenant(): Promise<string> {
  const tenantId = await requireTenant();
  if (!(await checkAccountManagementPermission())) {
    throw new Error('You do not have permission to manage AI usage billing');
  }
  return tenantId;
}

const UNAVAILABLE: AiGatewayUnavailable = { status: 'unavailable', reason: 'not_configured' };

/**
 * Returns the unavailable result (and logs once at debug level) when the AI
 * gateway is not configured, so unconfigured deployments never throw.
 */
async function gatewayUnavailable(action: string): Promise<AiGatewayUnavailable | null> {
  if (await isAiGatewayConfigured()) {
    return null;
  }
  logger.debug(`[${action}] AI gateway is not configured; returning unavailable`);
  return UNAVAILABLE;
}

export async function getAiAccountSummary(): Promise<AiGatewayResult<AiAccountSummary>> {
  const tenantId = await requireTenant();
  const unavailable = await gatewayUnavailable('getAiAccountSummary');
  if (unavailable) return unavailable;
  return { status: 'ok', data: await aiGatewayFetchAccount(tenantId) };
}

export async function getAiUsageHistory(query: AiUsageQuery): Promise<AiGatewayResult<AiUsagePage>> {
  const tenantId = await requireTenant();
  const unavailable = await gatewayUnavailable('getAiUsageHistory');
  if (unavailable) return unavailable;
  return { status: 'ok', data: await aiGatewayFetchUsage(tenantId, query) };
}

export async function setAiAutoTopup(
  settings: AiAutoTopupSettings,
): Promise<AiGatewayResult<AiAccountSummary>> {
  const tenantId = await requireBillingTenant();
  const unavailable = await gatewayUnavailable('setAiAutoTopup');
  if (unavailable) return unavailable;
  return { status: 'ok', data: await aiGatewaySetAutoTopup(tenantId, settings) };
}

export async function startAiAddonCheckout(): Promise<AiGatewayResult<{ checkoutUrl: string }>> {
  const tenantId = await requireBillingTenant();
  const unavailable = await gatewayUnavailable('startAiAddonCheckout');
  if (unavailable) return unavailable;
  return { status: 'ok', data: await createAiAddonCheckoutSession(tenantId) };
}

export async function startAiTopupCheckout(
  packPriceId: string,
): Promise<AiGatewayResult<{ checkoutUrl: string }>> {
  const tenantId = await requireBillingTenant();
  if (!packPriceId || typeof packPriceId !== 'string') {
    throw new Error('A top-up pack must be selected');
  }
  const unavailable = await gatewayUnavailable('startAiTopupCheckout');
  if (unavailable) return unavailable;
  return { status: 'ok', data: await createAiTopupCheckoutSession(tenantId, packPriceId) };
}

/**
 * A configured one-time top-up pack the tenant can buy.
 * Numbers stay plain numbers in the UI layer (§ plan: credits are JSON numbers).
 */
export interface AiTopupPack {
  priceId: string;
  label: string;
  credits: number | null;
}

/**
 * Env-driven top-up pack config: `AI_TOPUP_PACKS` is a JSON array of
 * `{ priceId, label, credits }`. This keeps pack definitions changeable
 * without a deploy (plan §4.1 tier_config) and without depending on the
 * gateway account payload, which does not expose the pack catalogue.
 *
 * TODO: once the gateway exposes the tier/pack catalogue on the account
 * endpoint (or a dedicated config surface lands), source packs from there and
 * drop this env fallback.
 */
export async function getAiTopupPacks(): Promise<AiTopupPack[]> {
  await requireTenant();
  const raw = process.env.AI_TOPUP_PACKS;
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        priceId: String(entry.priceId ?? ''),
        label: String(entry.label ?? entry.priceId ?? ''),
        credits: typeof entry.credits === 'number' ? entry.credits : null,
      }))
      .filter((pack) => pack.priceId.length > 0);
  } catch (error) {
    logger.warn('[getAiTopupPacks] Failed to parse AI_TOPUP_PACKS env config', error);
    return [];
  }
}

/**
 * Compile-time assertion that this module implements the frozen
 * `AiUsageActions` contract exactly. Not exported (a 'use server' module may
 * only export async functions); referenced with `void` to satisfy lint.
 */
const _aiUsageActionsContract: AiUsageActions = {
  getAiAccountSummary,
  getAiUsageHistory,
  setAiAutoTopup,
  startAiAddonCheckout,
  startAiTopupCheckout,
};
void _aiUsageActionsContract;
