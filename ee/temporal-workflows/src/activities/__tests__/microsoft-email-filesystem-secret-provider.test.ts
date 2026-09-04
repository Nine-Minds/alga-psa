import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({
  profiles: [] as Record<string, unknown>[],
  reconcilePollingProviders: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => undefined,
    getTenantSecret: readTenantSecretThroughNodeRuntime,
  }),
}));

vi.mock('@alga-psa/db', () => ({
  getAdminConnection: vi.fn(async () => ({})),
  tenantDb: () => ({
    table: () => ({
      where: (conditions: Record<string, unknown>) => ({
        first: async () => state.profiles.find((profile) =>
          Object.entries(conditions).every(([key, value]) => profile[key] === value)
        ),
      }),
    }),
  }),
}));

vi.mock('@alga-psa/shared/services/email/EmailWebhookMaintenanceService', () => ({
  EmailWebhookMaintenanceService: class {
    reconcilePollingProviders = state.reconcilePollingProviders;
  },
}));

import { buildMicrosoftEmailProviderConfig } from '@alga-psa/shared/services/email/microsoftEmailProviderConfig';
import { reconcilePollingMicrosoftProvidersActivity } from '../email-webhook-maintenance-activities';

const tenant = 'tenant-filesystem-seam';
const profileId = 'profile-filesystem-seam';
const secretRef = `microsoft_profile_${profileId}_client_secret`;
const secretValue = 'dummy-secret-not-for-logs';
let secretsDir = '';
let debugSpy: ReturnType<typeof vi.spyOn>;

function readTenantSecretThroughNodeRuntime(tenantId: string, name: string): string | undefined {
  const providerPath = path.resolve(
    import.meta.dirname,
    '../../../../../packages/core/src/lib/secrets/LazyFileSystemSecretProvider.ts'
  );
  const resultPath = path.join(secretsDir, 'filesystem-provider-result');
  const program = [
    `import { FileSystemSecretProvider } from ${JSON.stringify(providerPath)};`,
    `import { writeFileSync } from 'node:fs';`,
    `process.env.SECRET_FS_BASE_PATH = ${JSON.stringify(secretsDir)};`,
    'console.debug = console.error;',
    '(async () => {',
    '  const value = await new FileSystemSecretProvider().getTenantSecret(process.argv[1], process.argv[2]);',
    `  writeFileSync(${JSON.stringify(resultPath)}, value || '');`,
    '})();',
  ].join('\n');
  execFileSync(
    path.resolve(import.meta.dirname, '../../../../../node_modules/.bin/tsx'),
    ['-e', program, tenantId, name],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const value = readFileSync(resultPath, 'utf8') || undefined;
  unlink(resultPath).catch(() => undefined);
  return value;
}

function providerConfig() {
  return {
    id: 'provider-filesystem-seam',
    tenant,
    provider_type: 'microsoft',
    provider_config: {
      client_id: 'filesystem-client-id',
      microsoft_profile_id: profileId,
      client_secret_ref: secretRef,
      tenant_id: 'common',
    },
  } as any;
}

beforeEach(async () => {
  secretsDir = await mkdtemp(path.join(os.tmpdir(), 'alga-temporal-worker-secrets-'));
  process.env.SECRET_FS_BASE_PATH = secretsDir;
  state.profiles = [{
    profile_id: profileId,
    client_id: 'filesystem-client-id',
    client_secret_ref: secretRef,
    tenant_id: 'common',
    capabilities: JSON.stringify(['email']),
    is_archived: false,
  }];
  state.reconcilePollingProviders.mockReset();
  debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(async () => {
  debugSpy.mockRestore();
  delete process.env.SECRET_FS_BASE_PATH;
  await rm(secretsDir, { recursive: true, force: true });
});

describe('Microsoft polling filesystem secret seam', () => {
  it('resolves a pinned profile secret from SECRET_FS_BASE_PATH without logging its value', async () => {
    await mkdir(path.join(secretsDir, 'tenants', tenant), { recursive: true });
    await writeFile(path.join(secretsDir, 'tenants', tenant, secretRef), secretValue);

    const resolved = await buildMicrosoftEmailProviderConfig(providerConfig());

    expect(resolved.provider_config.resolved_client_secret).toBe(secretValue);
    expect(debugSpy.mock.calls.flat().join(' ')).not.toContain(secretValue);
  });

  it('fails closed with ms_email_provider_not_found when the shared secret file is absent', async () => {
    await expect(buildMicrosoftEmailProviderConfig(providerConfig())).rejects.toThrow('ms_email_provider_not_found');
  });

  it('delegates polling reconciliation without placing the resolved secret in activity logs', async () => {
    state.reconcilePollingProviders.mockResolvedValue([{ providerId: 'provider-filesystem-seam', renewed: true }]);

    await expect(reconcilePollingMicrosoftProvidersActivity({ tenantId: tenant, providerId: 'provider-filesystem-seam' }))
      .resolves.toEqual([{ providerId: 'provider-filesystem-seam', renewed: true }]);
    expect(state.reconcilePollingProviders).toHaveBeenCalledWith({ tenantId: tenant, providerId: 'provider-filesystem-seam' });
    expect(debugSpy.mock.calls.flat().join(' ')).not.toContain(secretValue);
  });
});
