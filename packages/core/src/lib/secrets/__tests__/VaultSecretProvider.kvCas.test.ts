import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultSecretProvider } from '../VaultSecretProvider';

type VaultDocument = { version: number; data: Record<string, unknown> };
type PendingRead = { response: ServerResponse; snapshot: VaultDocument };

const tenantId = 'tenant-vault-cas-test';
const secretPath = `kv/data/tenants/${tenantId}/secrets`;
let server: Server;
let vaultAddress: string;
let documents: Map<string, VaultDocument>;
let nextReadPair: PendingRead[] | null;
let casConflicts: number;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function snapshot(document: VaultDocument): VaultDocument {
  return { version: document.version, data: structuredClone(document.data) };
}

async function requestBody(request: IncomingMessage): Promise<{
  options?: { cas?: number };
  data: Record<string, unknown>;
}> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function respondRead(response: ServerResponse, document: VaultDocument): void {
  send(response, 200, {
    data: {
      data: document.data,
      metadata: {
        created_time: '2026-11-02T00:00:00Z',
        deletion_time: '',
        destroyed: false,
        version: document.version,
      },
    },
  });
}

function provider(): VaultSecretProvider {
  return new VaultSecretProvider();
}

describe('VaultSecretProvider KV v2 compare-and-set mutations', () => {
  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', vaultAddress).pathname.replace(/^\/v1\//, '');
      if (request.headers['x-vault-token'] !== 'test-token' || path !== secretPath) {
        send(response, 403, { errors: ['permission denied'] });
        return;
      }

      if (request.method === 'GET') {
        const current = documents.get(path);
        if (!current) {
          send(response, 404, { errors: ['no secret found'] });
          return;
        }
        if (nextReadPair) {
          const waiting = nextReadPair;
          waiting.push({ response, snapshot: snapshot(current) });
          if (waiting.length === 2) {
            nextReadPair = null;
            for (const read of waiting) respondRead(read.response, read.snapshot);
          }
          return;
        }
        respondRead(response, snapshot(current));
        return;
      }

      if (request.method === 'POST') {
        const body = await requestBody(request);
        const current = documents.get(path);
        const currentVersion = current?.version ?? 0;
        if (body.options?.cas !== currentVersion) {
          casConflicts += 1;
          send(response, 400, { errors: ['check-and-set parameter did not match the current version'] });
          return;
        }
        documents.set(path, {
          version: currentVersion + 1,
          data: body.data,
        });
        send(response, 200, { data: { version: currentVersion + 1 } });
        return;
      }

      send(response, 405, { errors: ['unsupported method'] });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Vault test server did not bind a TCP port');
    vaultAddress = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    // The shared server test setup restores stubbed environment variables after
    // each test, so establish the simulator configuration for every case.
    vi.stubEnv('VAULT_ADDR', vaultAddress);
    vi.stubEnv('VAULT_TOKEN', 'test-token');
    vi.stubEnv('VAULT_APP_SECRET_PATH', 'kv/data/app/secrets');
    vi.stubEnv('VAULT_TENANT_SECRET_PATH_TEMPLATE', 'kv/data/tenants/{tenantId}/secrets');
    documents = new Map();
    nextReadPair = null;
    casConflicts = 0;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    server.closeAllConnections();
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('retries concurrent staging writes from the latest Vault version and preserves every key', async () => {
    const firstProcess = provider();
    const secondProcess = provider();
    await firstProcess.setTenantSecret(tenantId, 'webhook_secret', 'whsec_existing');
    nextReadPair = [];

    await Promise.all([
      firstProcess.setTenantSecret(tenantId, 'stripe_payment_secret_key_version_a', 'sk_test_version_a'),
      secondProcess.setTenantSecret(tenantId, 'stripe_payment_secret_key_version_b', 'sk_test_version_b'),
    ]);

    expect(casConflicts).toBeGreaterThan(0);
    await expect(firstProcess.getTenantSecret(tenantId, 'webhook_secret')).resolves.toBe('whsec_existing');
    await expect(firstProcess.getTenantSecret(tenantId, 'stripe_payment_secret_key_version_a')).resolves.toBe('sk_test_version_a');
    await expect(secondProcess.getTenantSecret(tenantId, 'stripe_payment_secret_key_version_b')).resolves.toBe('sk_test_version_b');
  });

  it('keeps the published Stripe credential readable while another save and rollback cleanup race', async () => {
    const saveProcess = provider();
    const cleanupProcess = provider();
    const publishedName = 'stripe_payment_secret_key_published';
    await saveProcess.setTenantSecret(tenantId, publishedName, 'sk_test_published');
    await saveProcess.setTenantSecret(tenantId, 'stripe_payment_secret_key_staged_a', 'sk_test_staged_a');
    await saveProcess.setTenantSecret(tenantId, 'stripe_payment_secret_key_staged_b', 'sk_test_staged_b');

    nextReadPair = [];
    await Promise.all([
      saveProcess.setTenantSecret(tenantId, 'stripe_payment_secret_key_staged_c', 'sk_test_staged_c'),
      cleanupProcess.deleteTenantSecret(tenantId, 'stripe_payment_secret_key_staged_a'),
    ]);

    expect(casConflicts).toBeGreaterThan(0);
    await expect(cleanupProcess.getTenantSecret(tenantId, publishedName)).resolves.toBe('sk_test_published');
    await expect(saveProcess.getTenantSecret(tenantId, 'stripe_payment_secret_key_staged_b')).resolves.toBe('sk_test_staged_b');
    await expect(saveProcess.getTenantSecret(tenantId, 'stripe_payment_secret_key_staged_c')).resolves.toBe('sk_test_staged_c');
    await expect(saveProcess.getTenantSecret(tenantId, 'stripe_payment_secret_key_staged_a')).resolves.toBeUndefined();
  });

  it('routes null-valued writes through the same version-checked deletion path', async () => {
    const secretProvider = provider();
    await secretProvider.setTenantSecret(tenantId, 'stripe_payment_secret_key_rollback', 'sk_test_rollback');
    await secretProvider.setTenantSecret(tenantId, 'stripe_payment_secret_key_rollback', null);

    await expect(secretProvider.getTenantSecret(tenantId, 'stripe_payment_secret_key_rollback')).resolves.toBeUndefined();
  });
});
