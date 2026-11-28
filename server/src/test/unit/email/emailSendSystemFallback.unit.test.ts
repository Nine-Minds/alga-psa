/**
 * alga-2026-0002481 — workflow `email.send` for a tenant with no enabled tenant
 * provider falls back to the environment-backed system provider whenever its
 * credentials are present, with no EMAIL_ENABLE. EMAIL_ENABLE=false turns the
 * fallback off. Real EmailProviderManager, SystemEmailProviderFactory and
 * ResendEmailProvider; only the Resend HTTP call (axios) is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => {
  const instance = { post: postMock, get: vi.fn(), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
  const axiosMock = { create: vi.fn(() => instance), isAxiosError: () => false };
  return { default: axiosMock, ...axiosMock };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), system: vi.fn() },
}));

type Registered = { id: string; inputSchema: { parse: (v: unknown) => any }; handler: (input: any, ctx: any) => Promise<any> };
const registered: Registered[] = [];

const TENANT = '91a53464-0b67-4e3f-ae88-922d9c5af6ed';
const tx = { tenantId: TENANT, trx: {}, actorUserId: 'user-1' };
const managerRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('../../../../../shared/workflow/runtime/registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({ register: (a: Registered) => registered.push(a) }),
}));
vi.mock('../../../../../shared/workflow/runtime/registries/workflowEmailRegistry', async () => {
  const { EmailProviderManager } = await import('../../../../../packages/email/src/providers/EmailProviderManager');
  return {
    getWorkflowEmailProvider: () => ({
      TenantEmailService: Object.assign(class {}, {
        // Tenant has no enabled provider => managed outbound mail.
        getTenantEmailSettings: async () => ({ tenantId: TENANT, providerConfigs: [], outboundSenders: [] }),
        resolveOutboundSenderForTenant: async () => ({ from: { email: 'noreply@algapsa.com' } }),
        getInstance: () => ({
          // Deliver through the manager's chosen provider so the Resend HTTP call is exercised.
          sendEmail: async (params: any) => {
            const providers = await managerRef.current.getAvailableProviders(TENANT);
            const result = await providers[0].sendEmail({
              from: { email: 'noreply@algapsa.com' },
              to: params.to,
              subject: params.subject,
              html: params.html,
            });
            return { ...result, providerId: providers[0].providerId, providerType: providers[0].providerType, sentAt: new Date().toISOString() };
          },
        }),
      }),
      StaticTemplateProcessor: class {
        constructor(private s: string, private h: string) {}
        async process() { return { subject: this.s, html: this.h, text: undefined }; }
      },
      EmailProviderManager: class extends EmailProviderManager {
        constructor() { super(); managerRef.current = this; }
      },
      buildTenantPortalUrl: () => '',
    }),
  };
});

vi.mock('../../../../../shared/workflow/runtime/actions/businessOperations/shared', async () => {
  const actual = await vi.importActual<any>('../../../../../shared/workflow/runtime/actions/businessOperations/shared');
  return {
    ...actual,
    withTenantTransaction: async (_c: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    requirePermission: vi.fn(async () => undefined),
    writeRunAudit: vi.fn(async () => undefined),
  };
});

const KEYS = ['EMAIL_ENABLE', 'EMAIL_PROVIDER_TYPE', 'EMAIL_HOST', 'EMAIL_FROM', 'RESEND_API_KEY'] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const ctx = { tenantId: TENANT, runId: 'run-1', stepPath: 'root.steps[1]' };
const input = { to: [{ email: 'dl@example.com' }], subject: 'Hello', html: '<p>hi</p>' };

async function getHandler() {
  registered.length = 0;
  const { registerEmailActions } = await import('../../../../../shared/workflow/runtime/actions/businessOperations/email');
  registerEmailActions();
  return registered.find((a) => a.id === 'email.send')!;
}

describe('email.send system fallback (alga-2026-0002481)', () => {
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
    postMock.mockReset();
    postMock.mockResolvedValue({ status: 200, data: { id: 'resend-msg-1' } });
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('succeeds through the system Resend provider with credentials and no EMAIL_ENABLE', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    const action = await getHandler();
    const out = await action.handler(action.inputSchema.parse(input), ctx);
    expect(out.success).toBe(true);
    expect(out.provider_type).toBe('resend');
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('fails with "No enabled email provider configured" when EMAIL_ENABLE=false', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    process.env.EMAIL_ENABLE = 'false';
    const action = await getHandler();
    await expect(action.handler(action.inputSchema.parse(input), ctx)).rejects.toMatchObject({
      message: expect.stringContaining('No enabled email provider configured'),
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('fails the same way with no credentials and no flag (no crash)', async () => {
    const action = await getHandler();
    await expect(action.handler(action.inputSchema.parse(input), ctx)).rejects.toMatchObject({
      message: expect.stringContaining('No enabled email provider configured'),
    });
  });
});
