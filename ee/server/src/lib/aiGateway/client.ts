import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { toAiCreditsError } from './errors';
import {
  type AiAccountSummary,
  type AiAutoTopupSettings,
  type AiUsagePage,
  type AiUsageQuery,
} from './types';

const GATEWAY_TOKEN_TTL_SECONDS = 5 * 60;

function requireEnvironmentValue(name: 'AI_GATEWAY_SERVICE_SECRET' | 'AI_GATEWAY_URL'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function gatewayBaseUrl(): string {
  return requireEnvironmentValue('AI_GATEWAY_URL').replace(/\/+$/, '');
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`AI gateway returned invalid JSON (HTTP ${response.status})`);
  }
}

async function gatewayRequest<T>(
  tenantId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${gatewayBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${mintGatewayToken(tenantId)}`,
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });
  const body = await readJson(response);

  if (response.status === 402) {
    const creditsError = toAiCreditsError({ status: response.status, body });
    if (creditsError) {
      throw creditsError;
    }
  }

  if (!response.ok) {
    throw new Error(`AI gateway request failed (HTTP ${response.status})`);
  }

  return body as T;
}

export function mintGatewayToken(tenantId: string): string {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    throw new Error('tenantId is required to mint an AI gateway token');
  }

  return jwt.sign(
    { tenant_id: normalizedTenantId },
    requireEnvironmentValue('AI_GATEWAY_SERVICE_SECRET'),
    {
      algorithm: 'HS256',
      expiresIn: GATEWAY_TOKEN_TTL_SECONDS,
      jwtid: randomUUID(),
    },
  );
}

export async function aiGatewayFetchAccount(tenantId: string): Promise<AiAccountSummary> {
  return gatewayRequest<AiAccountSummary>(tenantId, '/v1/account');
}

export async function aiGatewayFetchUsage(
  tenantId: string,
  query: AiUsageQuery,
): Promise<AiUsagePage> {
  const search = new URLSearchParams();
  if (query.from !== undefined) search.set('from', query.from);
  if (query.to !== undefined) search.set('to', query.to);
  if (query.feature !== undefined) search.set('feature', query.feature);
  if (query.cursor !== undefined) search.set('cursor', query.cursor);
  if (query.limit !== undefined) search.set('limit', String(query.limit));
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return gatewayRequest<AiUsagePage>(tenantId, `/v1/account/usage${suffix}`);
}

export async function aiGatewaySetAutoTopup(
  tenantId: string,
  settings: AiAutoTopupSettings,
): Promise<AiAccountSummary> {
  return gatewayRequest<AiAccountSummary>(tenantId, '/v1/account/auto-topup', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}
