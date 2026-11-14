import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProviderConfig } from '@alga-psa/types';
import { validateSecretComponent } from '../../../core/src/lib/secrets/fsSecretCore';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: warnMock },
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));

import {
  PROVIDER_SECRET_FIELDS,
  SECRET_MASK,
  persistProviderSecrets,
  redactProviderConfigs,
  resolveProviderSecrets,
} from '../providerSecrets';

const TENANT = 'tenant-1';
const NAME_PATTERN = /^email_outbound_(smtp_password|resend_api_key)_[0-9a-f-]{36}$/;

function makeStore() {
  const data = new Map<string, string>();
  return {
    data,
    getTenantSecret: vi.fn(async (_t: string, name: string) => data.get(name)),
    setTenantSecret: vi.fn(async (_t: string, name: string, value: string | null) => {
      if (value === null) data.delete(name); else data.set(name, value);
    }),
    deleteTenantSecret: vi.fn(async (_t: string, name: string) => { data.delete(name); }),
  };
}

const smtp = (config: Record<string, any>, providerId = 'smtp-provider'): EmailProviderConfig => ({
  providerId, providerType: 'smtp', isEnabled: true, config: { host: 'h', port: 587, ...config },
});
const resend = (config: Record<string, any>, providerId = 'resend-provider'): EmailProviderConfig => ({
  providerId, providerType: 'resend', isEnabled: true, config: { from: 'a@b.test', ...config },
});

describe('providerSecrets', () => {
  beforeEach(() => warnMock.mockReset());

  describe('persistProviderSecrets', () => {
    it('writes a new value to a versioned ref and strips plaintext', async () => {
      const store = makeStore();
      const { configs, committedRefs, staleRefs } = await persistProviderSecrets(
        TENANT, [smtp({ password: 'fake-pw-1' })], undefined, store);
      const ref = configs[0].config.secretRefs.password;
      expect(ref).toMatch(NAME_PATTERN);
      expect(store.data.get(ref)).toBe('fake-pw-1');
      expect(configs[0].config).not.toHaveProperty('password');
      expect(committedRefs).toEqual([ref]);
      expect(staleRefs).toEqual([]);
      expect(JSON.stringify(configs)).not.toContain('fake-pw-1');
    });

    it('keeps the existing ref on the mask', async () => {
      const store = makeStore();
      const first = await persistProviderSecrets(TENANT, [smtp({ password: 'fake-pw-1' })], undefined, store);
      store.setTenantSecret.mockClear();
      const second = await persistProviderSecrets(TENANT, [smtp({ password: SECRET_MASK })], first.configs, store);
      expect(second.configs[0].config.secretRefs).toEqual(first.configs[0].config.secretRefs);
      expect(store.setTenantSecret).not.toHaveBeenCalled();
      expect(second.committedRefs).toEqual([]);
      expect(second.staleRefs).toEqual([]);
    });

    it('rotates: new ref committed, old ref stale', async () => {
      const store = makeStore();
      const first = await persistProviderSecrets(TENANT, [smtp({ password: 'fake-pw-1' })], undefined, store);
      const old = first.configs[0].config.secretRefs.password;
      const second = await persistProviderSecrets(TENANT, [smtp({ password: 'fake-pw-2' })], first.configs, store);
      expect(second.configs[0].config.secretRefs.password).not.toBe(old);
      expect(second.staleRefs).toEqual([old]);
      expect(store.data.get(old)).toBe('fake-pw-1'); // old stays until the caller commits
    });

    it('clears on empty string, queueing the old ref for deletion', async () => {
      const store = makeStore();
      const first = await persistProviderSecrets(TENANT, [smtp({ password: 'fake-pw-1' })], undefined, store);
      const old = first.configs[0].config.secretRefs.password;
      const second = await persistProviderSecrets(TENANT, [smtp({ password: '' })], first.configs, store);
      expect(second.configs[0].config).not.toHaveProperty('secretRefs');
      expect(second.configs[0].config).not.toHaveProperty('password');
      expect(second.staleRefs).toEqual([old]);
    });

    it('migrates legacy plaintext when the incoming value is the mask', async () => {
      const store = makeStore();
      const { configs, committedRefs } = await persistProviderSecrets(
        TENANT, [smtp({ password: SECRET_MASK })], [smtp({ password: 'legacy-pw' })], store);
      const ref = configs[0].config.secretRefs.password;
      expect(store.data.get(ref)).toBe('legacy-pw');
      expect(committedRefs).toEqual([ref]);
      expect(JSON.stringify(configs)).not.toContain('legacy-pw');
    });

    it('strips the api_key alias and stores under the canonical field', async () => {
      const store = makeStore();
      const { configs } = await persistProviderSecrets(
        TENANT, [resend({ api_key: 'fake-key', apiKey: 'fake-key' })], undefined, store);
      expect(configs[0].config).not.toHaveProperty('api_key');
      expect(configs[0].config).not.toHaveProperty('apiKey');
      expect(configs[0].config.secretRefs.apiKey).toMatch(/^email_outbound_resend_api_key_/);
    });

    it('migrates legacy api_key alias on mask/missing', async () => {
      const store = makeStore();
      const { configs } = await persistProviderSecrets(
        TENANT, [resend({})], [resend({ api_key: 'legacy-key' })], store);
      expect(store.data.get(configs[0].config.secretRefs.apiKey)).toBe('legacy-key');
    });

    it('never trusts client-supplied secretRefs', async () => {
      const store = makeStore();
      const { configs } = await persistProviderSecrets(
        TENANT, [smtp({ secretRefs: { password: 'someone_elses_secret' } })], undefined, store);
      expect(configs[0].config).not.toHaveProperty('secretRefs');
    });

    it('names never include providerId or client values and are valid path components', async () => {
      const store = makeStore();
      const hostile = '../../etc/passwd';
      const { committedRefs } = await persistProviderSecrets(
        TENANT, [smtp({ password: 'p' }, hostile), resend({ apiKey: 'k' }, 'prov/../x')], undefined, store);
      expect(committedRefs).toHaveLength(2);
      for (const name of committedRefs) {
        expect(name).toMatch(NAME_PATTERN);
        expect(name).not.toContain('passwd');
        expect(name).not.toContain('prov');
        expect(() => validateSecretComponent(name, 'secret name')).not.toThrow();
      }
    });

    it('queues refs of configs dropped by the save', async () => {
      const store = makeStore();
      const first = await persistProviderSecrets(TENANT, [smtp({ password: 'p' })], undefined, store);
      const old = first.configs[0].config.secretRefs.password;
      const second = await persistProviderSecrets(TENANT, [resend({})], first.configs, store);
      expect(second.staleRefs).toEqual([old]);
    });

    it('queues refs when a providerId is re-saved under a different provider type', async () => {
      const store = makeStore();
      const first = await persistProviderSecrets(TENANT, [smtp({ password: 'p' }, 'shared-id')], undefined, store);
      const old = first.configs[0].config.secretRefs.password;
      const second = await persistProviderSecrets(TENANT, [resend({ apiKey: 'k' }, 'shared-id')], first.configs, store);
      expect(second.staleRefs).toEqual([old]);
      expect(second.configs[0].config.secretRefs.apiKey).toMatch(NAME_PATTERN);
    });

    it('deletes already-written refs if a later write fails', async () => {
      const store = makeStore();
      store.setTenantSecret.mockImplementationOnce(async (_t, name, value) => { store.data.set(name, value as string); });
      store.setTenantSecret.mockImplementationOnce(async () => { throw new Error('vault down'); });
      await expect(persistProviderSecrets(
        TENANT, [smtp({ password: 'p' }), resend({ apiKey: 'k' })], undefined, store)).rejects.toThrow('vault down');
      expect(store.data.size).toBe(0);
    });

    it('exposes secret fields per provider type', () => {
      expect(PROVIDER_SECRET_FIELDS.smtp[0].field).toBe('password');
      expect(PROVIDER_SECRET_FIELDS.resend[0]).toMatchObject({ field: 'apiKey', aliases: ['api_key'] });
    });
  });

  describe('resolveProviderSecrets', () => {
    it('resolves a ref to its value without leaking refs into runtime config', async () => {
      const store = makeStore();
      const { configs } = await persistProviderSecrets(TENANT, [smtp({ password: 'fake-pw-1' })], undefined, store);
      const runtime = await resolveProviderSecrets(TENANT, configs[0], store);
      expect(runtime.password).toBe('fake-pw-1');
      expect(runtime).not.toHaveProperty('secretRefs');
      expect(runtime.host).toBe('h');
    });

    it('throws EMAIL_PROVIDER_SECRET_MISSING when the ref cannot be read', async () => {
      const store = makeStore();
      const { configs } = await persistProviderSecrets(TENANT, [smtp({ password: 'p' })], undefined, store);
      store.data.clear();
      await expect(resolveProviderSecrets(TENANT, configs[0], store)).rejects.toMatchObject({
        errorCode: 'EMAIL_PROVIDER_SECRET_MISSING',
        message: expect.stringContaining('re-enter it in Outbound Email settings'),
      });
    });

    it('throws EMAIL_PROVIDER_SECRET_MISSING when the store errors, without the cause message', async () => {
      const store = makeStore();
      const { configs } = await persistProviderSecrets(TENANT, [smtp({ password: 'p' })], undefined, store);
      store.getTenantSecret.mockRejectedValueOnce(new Error('permission denied'));
      await expect(resolveProviderSecrets(TENANT, configs[0], store)).rejects.toMatchObject({
        errorCode: 'EMAIL_PROVIDER_SECRET_MISSING',
      });
    });

    it('rejects a ref that does not have the generated shape', async () => {
      const store = makeStore();
      store.data.set('other_integration_secret', 'x');
      await expect(resolveProviderSecrets(
        TENANT, smtp({ secretRefs: { password: 'other_integration_secret' } }), store)).rejects.toMatchObject({
        errorCode: 'EMAIL_PROVIDER_SECRET_MISSING',
      });
      expect(store.getTenantSecret).not.toHaveBeenCalled();
    });

    it('passes legacy plaintext through with a warning that carries no value', async () => {
      const store = makeStore();
      const runtime = await resolveProviderSecrets(TENANT, smtp({ password: 'legacy-pw' }), store);
      expect(runtime.password).toBe('legacy-pw');
      expect(warnMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warnMock.mock.calls)).not.toContain('legacy-pw');
    });

    it('returns no secret and no warning when neither ref nor legacy value exists', async () => {
      const runtime = await resolveProviderSecrets(TENANT, resend({ apiKey: '' }), makeStore());
      expect(runtime.apiKey ?? '').toBe('');
      expect(warnMock).not.toHaveBeenCalled();
    });
  });

  describe('redactProviderConfigs', () => {
    it('removes secrets, aliases and secretRefs; mask reflects presence', async () => {
      const store = makeStore();
      const { configs } = await persistProviderSecrets(TENANT, [smtp({ password: 'fake-pw-1' })], undefined, store);
      const out = redactProviderConfigs([
        configs[0],
        resend({ api_key: 'legacy-key' }),
        resend({ apiKey: '' }, 'resend-2'),
        smtp({}, 'smtp-2'),
        { providerId: 'ms', providerType: 'microsoft', isEnabled: false, config: { secretRefs: { x: 'y' }, mailbox: 'm' } },
      ]);
      expect(out[0].config.password).toBe('***');
      expect(out[1].config.apiKey).toBe('***');
      expect(out[2].config.apiKey).toBe('');
      expect(out[3].config.password).toBe('');
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain('secretRefs');
      expect(serialized).not.toContain('api_key');
      expect(serialized).not.toContain('email_outbound_');
      expect(serialized).not.toContain('legacy-key');
      expect(serialized).not.toContain('fake-pw-1');
      expect(out[4].config.mailbox).toBe('m');
    });
  });
});
