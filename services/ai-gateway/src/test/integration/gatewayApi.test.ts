import { randomUUID } from 'node:crypto';
import {
  createServer,
  request as createHttpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';

import type { Knex } from 'knex';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { findOrCreateAccount } from '../../accounts/accounts.js';
import { StubApplianceCredentialVerifier } from '../../auth/applianceVerifier.js';
import { GatewayAuthenticator } from '../../auth/authenticator.js';
import { HostedJwtVerifier } from '../../auth/hostedJwt.js';
import { createDatabase } from '../../db/client.js';
import { createApp } from '../../http/app.js';
import { debitUsage } from '../../ledger/ledger.js';
import { OpenRouterProvider } from '../../providers/openRouter.js';
import type { ProviderRouter } from '../../providers/types.js';
import type { TierConfig } from '../../tier/tierConfig.js';

const testDatabaseUrl = process.env.AI_GATEWAY_TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SERVICE_SECRET = 'integration-service-secret-with-enough-entropy';
const ADMIN_TOKEN = 'integration-admin-token';
const APPLIANCE_CREDENTIAL = 'integration-appliance-credential';
const TEST_TIER_CONFIG: TierConfig = {
  monthlyIncludedCredits: 100n,
  gracePercentBasisPoints: 1_000n,
  topupPacks: [{ priceId: 'price_topup_test', credits: 25n }],
  lowBalanceThreshold: 10n,
};
const getTestTierConfig = async (): Promise<TierConfig> => TEST_TIER_CONFIG;

type ProviderMode = 'nonstream' | 'stream' | 'disconnect' | 'error';

interface FakeProviderState {
  mode: ProviderMode;
  lastBody: Record<string, unknown> | null;
  lastHeaders: IncomingMessage['headers'] | null;
}

interface UsageRow {
  feature: string;
  request_id: string;
  prompt_tokens: string;
  completion_tokens: string;
  total_tokens: string;
  credits_charged: string;
  duration_ms: string;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Test server did not bind to a TCP port'));
        return;
      }
      resolve(address.port);
    });
    server.once('error', reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function writeStream(response: ServerResponse, delayed: boolean): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write('data: {"id":"chunk-1","choices":[{"delta":{"content":"hello"}}]}\n\n');
  const finish = (): void => {
    response.write(
      'data: {"id":"chunk-2","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}\n\n',
    );
    response.end('data: [DONE]\n\n');
  };
  if (delayed) {
    setTimeout(finish, 40);
  } else {
    finish();
  }
}

function createFakeProviderServer(state: FakeProviderState): Server {
  return createServer((request, response) => {
    void (async () => {
      state.lastHeaders = request.headers;
      state.lastBody = await readRequestBody(request);

      if (state.mode === 'error') {
        response.writeHead(429, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'provider-private-detail' } }));
        return;
      }
      if (state.mode === 'stream' || state.mode === 'disconnect') {
        writeStream(response, state.mode === 'disconnect');
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Request-Id': 'upstream-request-id',
      });
      response.end(
        JSON.stringify({
          id: 'completion-1',
          choices: [{ message: { role: 'assistant', content: 'hello' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      );
    })().catch((error: unknown) => {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: String(error) }));
    });
  });
}

function hostedAuthorization(tenantId: string): string {
  return `Bearer ${jwt.sign({ tenant_id: tenantId }, SERVICE_SECRET, {
    algorithm: 'HS256',
    expiresIn: 300,
  })}`;
}

async function activateAccount(
  database: Knex,
  tenantId: string,
  deploymentType: 'hosted' | 'appliance' = 'hosted',
  includedBalance = 100n,
): Promise<string> {
  const account = await findOrCreateAccount(
    database,
    { tenantId, deploymentType },
    getTestTierConfig,
  );
  await database('ai_accounts').where({ account_id: account.account_id }).update({
    subscription_status: 'active',
    included_balance: includedBalance.toString(),
    topup_balance: '0',
    grace_limit_credits: '0',
    low_balance_threshold: '10',
    cycle_started_at: new Date('2026-07-01T00:00:00.000Z'),
    updated_at: new Date(),
  });
  return account.account_id;
}

async function usageCount(database: Knex, accountId: string): Promise<number> {
  const row = await database('ai_usage_events')
    .where({ account_id: accountId })
    .count<{ count: string }>('* as count')
    .first();
  return Number.parseInt(row?.count ?? '0', 10);
}

async function waitForUsage(database: Knex, accountId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await usageCount(database, accountId)) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the disconnected stream debit');
}

async function disconnectAfterFirstChunk(
  url: string,
  authorization: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = createHttpRequest(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          'X-Alga-AI-Feature': 'chat',
        },
      },
      (response) => {
        response.once('data', () => {
          response.destroy();
          resolve();
        });
      },
    );
    request.once('error', reject);
    request.end(JSON.stringify({ model: 'test-model', messages: [], stream: true }));
  });
}

describeWithDatabase('AI gateway HTTP API', () => {
  let database: Knex;
  let fakeProviderServer: Server;
  let gatewayServer: Server;
  let gatewayUrl: string;
  let fakeProviderUrl: string;
  const applianceTenantId = randomUUID();
  const providerState: FakeProviderState = {
    mode: 'nonstream',
    lastBody: null,
    lastHeaders: null,
  };

  beforeAll(async () => {
    database = createDatabase({ connectionString: testDatabaseUrl, poolMax: 12 });
    await database.migrate.latest({
      directory: path.resolve(process.cwd(), 'migrations'),
      extension: 'cjs',
      tableName: 'knex_migrations',
    });

    fakeProviderServer = createFakeProviderServer(providerState);
    const fakeProviderPort = await listen(fakeProviderServer);
    fakeProviderUrl = `http://127.0.0.1:${fakeProviderPort}/v1`;
    const provider = new OpenRouterProvider({ apiKey: 'provider-key', baseUrl: fakeProviderUrl });
    const providerRouter: ProviderRouter = { resolve: () => provider };
    const authenticator = new GatewayAuthenticator({
      hostedTokenVerifier: new HostedJwtVerifier({ secret: SERVICE_SECRET }),
      applianceCredentialVerifier: new StubApplianceCredentialVerifier(
        applianceTenantId,
        'enterprise',
      ),
    });
    gatewayServer = createApp({
      database,
      authenticator,
      providerRouter,
      defaultPricingRate: {
        inputCreditsPer1kTokens: 1_000n,
        outputCreditsPer1kTokens: 1_000n,
      },
      adminToken: ADMIN_TOKEN,
      getTierConfig: getTestTierConfig,
    }).listen(0, '127.0.0.1');
    const gatewayPort = await new Promise<number>((resolve, reject) => {
      gatewayServer.once('listening', () => {
        const address = gatewayServer.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Gateway test server did not bind to a TCP port'));
          return;
        }
        resolve(address.port);
      });
      gatewayServer.once('error', reject);
    });
    gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  });

  beforeEach(async () => {
    providerState.mode = 'nonstream';
    providerState.lastBody = null;
    providerState.lastHeaders = null;
    await database.raw(`
      TRUNCATE TABLE
        auto_topup_jobs,
        credit_ledger,
        ai_usage_events,
        consent_records,
        pricing_config,
        tier_config,
        stripe_webhook_events,
        ai_accounts
      RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    if (gatewayServer) await close(gatewayServer);
    if (fakeProviderServer) await close(fakeProviderServer);
    if (database) await database.destroy();
  });

  it('captures non-stream usage, preserves request attribution, and debits once', async () => {
    const tenantId = randomUUID();
    const accountId = await activateAccount(database, tenantId, 'hosted', 20n);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: hostedAuthorization(tenantId),
        'Content-Type': 'application/json',
        'X-Alga-AI-Feature': 'future-ai-feature',
        'X-Request-Id': 'caller-request-id',
      },
      body: JSON.stringify({ model: 'test-model', messages: [] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'completion-1' });
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
    expect(providerState.lastHeaders?.['x-request-id']).toBe('caller-request-id');
    expect(providerState.lastHeaders?.['x-alga-ai-feature']).toBe('future-ai-feature');

    const usage = await database<UsageRow>('ai_usage_events')
      .where({ account_id: accountId })
      .first();
    expect(usage).toMatchObject({
      feature: 'future-ai-feature',
      request_id: 'caller-request-id',
      prompt_tokens: '3',
      completion_tokens: '2',
      total_tokens: '5',
      credits_charged: '5',
    });
    expect(BigInt(usage?.duration_ms ?? '-1')).toBeGreaterThanOrEqual(0n);
    expect(await database('ai_accounts').where({ account_id: accountId }).first('included_balance'))
      .toMatchObject({ included_balance: '15' });
  });

  it('passes SSE bytes through and captures the injected terminal usage chunk', async () => {
    providerState.mode = 'stream';
    const tenantId = randomUUID();
    const accountId = await activateAccount(database, tenantId, 'hosted', 20n);

    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: hostedAuthorization(tenantId),
        'Content-Type': 'application/json',
        'X-Alga-AI-Feature': 'chat',
      },
      body: JSON.stringify({ model: 'test-model', messages: [], stream: true }),
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe(
      'data: {"id":"chunk-1","choices":[{"delta":{"content":"hello"}}]}\n\n' +
        'data: {"id":"chunk-2","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}\n\n' +
        'data: [DONE]\n\n',
    );
    expect(providerState.lastBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(await usageCount(database, accountId)).toBe(1);
    expect(await database('ai_accounts').where({ account_id: accountId }).first('included_balance'))
      .toMatchObject({ included_balance: '13' });
  });

  it('drains the upstream and debits after the client disconnects', async () => {
    providerState.mode = 'disconnect';
    const tenantId = randomUUID();
    const accountId = await activateAccount(database, tenantId, 'hosted', 20n);

    await disconnectAfterFirstChunk(
      `${gatewayUrl}/v1/chat/completions`,
      hostedAuthorization(tenantId),
    );
    await waitForUsage(database, accountId);

    expect(await usageCount(database, accountId)).toBe(1);
    expect(await database('ai_accounts').where({ account_id: accountId }).first('included_balance'))
      .toMatchObject({ included_balance: '13' });
  });

  it('propagates a safe provider error and does not debit', async () => {
    providerState.mode = 'error';
    const tenantId = randomUUID();
    const accountId = await activateAccount(database, tenantId, 'hosted', 20n);

    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: hostedAuthorization(tenantId),
        'Content-Type': 'application/json',
        'X-Alga-AI-Feature': 'chat',
      },
      body: JSON.stringify({ model: 'test-model', messages: [] }),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: {
        code: 'provider_error',
        message: 'The upstream AI provider rejected the request.',
      },
    });
    expect(JSON.stringify(body)).not.toContain('provider-private-detail');
    expect(await usageCount(database, accountId)).toBe(0);
    expect(await database('ai_accounts').where({ account_id: accountId }).first('included_balance'))
      .toMatchObject({ included_balance: '20' });
  });

  it('returns the frozen account summary and updates auto-topup settings', async () => {
    const tenantId = randomUUID();
    const accountId = await activateAccount(database, tenantId, 'hosted', 25n);

    const accountResponse = await fetch(`${gatewayUrl}/v1/account`, {
      headers: { Authorization: hostedAuthorization(tenantId) },
    });
    expect(await accountResponse.json()).toEqual({
      subscriptionStatus: 'active',
      includedBalanceCredits: 25,
      topupBalanceCredits: 0,
      graceLimitCredits: 0,
      totalBalanceCredits: 25,
      lowBalance: false,
      cycleStartedAt: '2026-07-01T00:00:00.000Z',
      autoTopup: { enabled: false, thresholdCredits: null, packPriceId: null },
      consentStatus: 'granted',
      consent: {
        status: 'granted',
        grantedBy: null,
        termsVersion: null,
        grantedAt: null,
        revokedAt: null,
        revokedBy: null,
      },
    });

    const updateResponse = await fetch(`${gatewayUrl}/v1/account/auto-topup`, {
      method: 'POST',
      headers: {
        Authorization: hostedAuthorization(tenantId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        thresholdCredits: '8',
        packPriceId: 'price_topup_test',
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      autoTopup: {
        enabled: true,
        thresholdCredits: 8,
        packPriceId: 'price_topup_test',
      },
    });
    expect(
      await database('ai_accounts').where({ account_id: accountId }).first([
        'auto_topup_enabled',
        'auto_topup_threshold_credits',
        'auto_topup_pack_price_id',
      ]),
    ).toMatchObject({
      auto_topup_enabled: true,
      auto_topup_threshold_credits: '8',
      auto_topup_pack_price_id: 'price_topup_test',
    });
  });

  it('pages usage with an opaque cursor and applies the feature filter', async () => {
    const tenantId = randomUUID();
    const accountId = await activateAccount(database, tenantId);
    await debitUsage(database, {
      accountId,
      feature: 'chat',
      model: 'test-model',
      provider: 'openrouter',
      promptTokens: 1n,
      completionTokens: 1n,
      totalTokens: 2n,
      creditsCharged: 2n,
      requestId: randomUUID(),
      durationMs: 1n,
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    });
    await debitUsage(database, {
      accountId,
      feature: 'chat',
      model: 'test-model',
      provider: 'openrouter',
      promptTokens: 2n,
      completionTokens: 1n,
      totalTokens: 3n,
      creditsCharged: 3n,
      requestId: randomUUID(),
      durationMs: 1n,
      createdAt: new Date('2026-07-20T09:00:00.000Z'),
    });
    await debitUsage(database, {
      accountId,
      feature: 'chat-title',
      model: 'test-model',
      provider: 'openrouter',
      promptTokens: 1n,
      completionTokens: 1n,
      totalTokens: 2n,
      creditsCharged: 2n,
      requestId: randomUUID(),
      durationMs: 1n,
      createdAt: new Date('2026-07-20T08:00:00.000Z'),
    });

    const firstResponse = await fetch(
      `${gatewayUrl}/v1/account/usage?feature=chat&limit=1`,
      { headers: { Authorization: hostedAuthorization(tenantId) } },
    );
    const first = (await firstResponse.json()) as {
      events: Array<{ createdAt: string }>;
      nextCursor: string | null;
    };
    expect(first.events).toHaveLength(1);
    expect(first.events[0]?.createdAt).toBe('2026-07-20T10:00:00.000Z');
    expect(first.nextCursor).toEqual(expect.any(String));

    const secondResponse = await fetch(
      `${gatewayUrl}/v1/account/usage?feature=chat&limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      { headers: { Authorization: hostedAuthorization(tenantId) } },
    );
    const second = (await secondResponse.json()) as {
      events: Array<{ createdAt: string }>;
      nextCursor: string | null;
    };
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.createdAt).toBe('2026-07-20T09:00:00.000Z');
    expect(second.nextCursor).toBeNull();
  });

  it('enforces appliance consent immediately across grant and revoke', async () => {
    const accountId = await activateAccount(database, applianceTenantId, 'appliance', 20n);
    const requestOptions = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${APPLIANCE_CREDENTIAL}`,
        'Content-Type': 'application/json',
        'X-Alga-AI-Feature': 'chat',
      },
      body: JSON.stringify({ model: 'test-model', messages: [] }),
    };

    const denied = await fetch(`${gatewayUrl}/v1/chat/completions`, requestOptions);
    expect(denied.status).toBe(402);
    expect(await denied.json()).toMatchObject({ error: { code: 'consent_required' } });

    const granted = await fetch(`${gatewayUrl}/v1/consent`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${APPLIANCE_CREDENTIAL}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grantedBy: 'admin@example.test', termsVersion: '2026-07-20' }),
    });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toMatchObject({
      consentStatus: 'granted',
      consent: {
        status: 'granted',
        grantedBy: 'admin@example.test',
        termsVersion: '2026-07-20',
        revokedAt: null,
        revokedBy: null,
      },
    });

    expect((await fetch(`${gatewayUrl}/v1/chat/completions`, requestOptions)).status).toBe(200);
    expect(await usageCount(database, accountId)).toBe(1);

    const revoked = await fetch(`${gatewayUrl}/v1/consent`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${APPLIANCE_CREDENTIAL}` },
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({
      consentStatus: 'revoked',
      consent: { status: 'revoked', termsVersion: '2026-07-20' },
    });
    const deniedAgain = await fetch(`${gatewayUrl}/v1/chat/completions`, requestOptions);
    expect(deniedAgain.status).toBe(402);
    expect(await deniedAgain.json()).toMatchObject({ error: { code: 'consent_required' } });
  });

  it('returns no_subscription and out_of_credits as structured 402 errors', async () => {
    const tenantId = randomUUID();
    const authorization = hostedAuthorization(tenantId);
    const options = {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        'X-Alga-AI-Feature': 'chat',
      },
      body: JSON.stringify({ model: 'test-model', messages: [] }),
    };

    const noSubscription = await fetch(`${gatewayUrl}/v1/chat/completions`, options);
    expect(noSubscription.status).toBe(402);
    expect(await noSubscription.json()).toMatchObject({ error: { code: 'no_subscription' } });

    const account = await findOrCreateAccount(
      database,
      { tenantId, deploymentType: 'hosted' },
      getTestTierConfig,
    );
    await database('ai_accounts').where({ account_id: account.account_id }).update({
      subscription_status: 'active',
      included_balance: '-5',
      topup_balance: '0',
      grace_limit_credits: '5',
    });
    const outOfCredits = await fetch(`${gatewayUrl}/v1/chat/completions`, options);
    expect(outOfCredits.status).toBe(402);
    expect(await outOfCredits.json()).toMatchObject({ error: { code: 'out_of_credits' } });
  });

  it('guards manual grants with the admin token and writes an adjustment', async () => {
    const tenantId = randomUUID();
    const accountId = await activateAccount(database, tenantId, 'hosted', 10n);
    const body = JSON.stringify({
      accountId,
      credits: '25',
      bucket: 'topup',
      note: 'support credit',
    });

    expect(
      (
        await fetch(`${gatewayUrl}/v1/admin/grants`, {
          method: 'POST',
          headers: { Authorization: 'Bearer wrong-token', 'Content-Type': 'application/json' },
          body,
        })
      ).status,
    ).toBe(401);

    const response = await fetch(`${gatewayUrl}/v1/admin/grants`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      accountId,
      credits: '25',
      bucket: 'topup',
      balanceAfter: '35',
    });
    expect(await database('credit_ledger').where({ account_id: accountId }).first())
      .toMatchObject({ entry_type: 'adjustment', credits: '25', balance_after: '35' });
  });
});
