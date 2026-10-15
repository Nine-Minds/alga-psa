/**
 * alga-2026-0002379 — the terminal step of a "new ticket -> email" workflow.
 *
 * Proves the `email.send` action handler is reached with the workflow's input and
 * hands the rendered message to TenantEmailService, and that the two customer-side
 * gates (missing `email:process` for the workflow publisher, missing tenant email
 * settings) fail loudly with a specific error instead of silently doing nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Registered = { id: string; inputSchema: { parse: (v: unknown) => any }; handler: (input: any, ctx: any) => Promise<any> };
const registered: Registered[] = [];

const requirePermissionMock = vi.fn();
const writeRunAuditMock = vi.fn();
const sendEmailMock = vi.fn();
const getTenantEmailSettingsMock = vi.fn();
const getAvailableProvidersMock = vi.fn();

const TENANT = '91a53464-0b67-4e3f-ae88-922d9c5af6ed';
const tx = { tenantId: TENANT, trx: {}, actorUserId: 'user-1' };

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));

vi.mock('../../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({ register: (a: Registered) => registered.push(a) }),
}));

vi.mock('../../../registries/workflowEmailRegistry', () => ({
  getWorkflowEmailProvider: () => ({
    TenantEmailService: Object.assign(
      class {},
      {
        getTenantEmailSettings: (...a: unknown[]) => getTenantEmailSettingsMock(...a),
        getInstance: () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }),
      }
    ),
    StaticTemplateProcessor: class {
      constructor(private s: string, private h: string, private t?: string) {}
      async process({ templateData }: { templateData: Record<string, unknown> }) {
        const fill = (x?: string) => x?.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(templateData[k] ?? ''));
        return { subject: fill(this.s), html: fill(this.h), text: fill(this.t) };
      }
    },
    EmailProviderManager: class {
      async initialize() {}
      getAvailableProviders = (...a: unknown[]) => getAvailableProvidersMock(...a);
    },
  }),
}));

vi.mock('../shared', async () => {
  const actual = await vi.importActual<typeof import('../shared')>('../shared');
  return {
    ...actual,
    withTenantTransaction: async (_ctx: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    requirePermission: (...a: unknown[]) => requirePermissionMock(...a),
    writeRunAudit: (...a: unknown[]) => writeRunAuditMock(...a),
  };
});

const ctx = { tenantId: TENANT, runId: 'run-1', stepPath: 'root.steps[1]' };
const input = {
  to: [{ email: 'dl@aja.example' }],
  subject: 'New ticket {{ticket}}',
  html: '<p>{{ticket}}</p>',
  template_data: { ticket: 'T-100' },
};

async function getHandler() {
  registered.length = 0;
  const { registerEmailActions } = await import('../email');
  registerEmailActions();
  const action = registered.find((a) => a.id === 'email.send');
  expect(action).toBeDefined();
  return action!;
}

describe('email.send handler (alga-2026-0002379)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue(undefined);
    getTenantEmailSettingsMock.mockResolvedValue({ providerConfigs: [{ providerId: 'p1' }], outboundSenders: [] });
    getAvailableProvidersMock.mockResolvedValue([{ capabilities: { supportsAttachments: true } }]);
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1', providerId: 'p1', providerType: 'smtp', sentAt: new Date().toISOString() });
  });

  it('checks email:process, renders the template and sends through TenantEmailService', async () => {
    const action = await getHandler();
    const out = await action.handler(action.inputSchema.parse(input), ctx);

    expect(requirePermissionMock).toHaveBeenCalledWith(ctx, tx, { resource: 'email', action: 'process' });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({
      to: [{ email: 'dl@aja.example' }],
      subject: 'New ticket T-100',
      html: '<p>T-100</p>',
    });
    expect(out).toMatchObject({ success: true, message_id: 'm-1', status: 'sent' });
    expect(writeRunAuditMock).toHaveBeenCalled();
  });

  it('fails visibly (PERMISSION_DENIED) and sends nothing when the workflow publisher lacks email:process', async () => {
    requirePermissionMock.mockRejectedValue({ category: 'ActionError', code: 'PERMISSION_DENIED', message: 'Permission denied: email:process' });
    const action = await getHandler();

    await expect(action.handler(action.inputSchema.parse(input), ctx)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('fails visibly when tenant email settings are missing', async () => {
    getTenantEmailSettingsMock.mockResolvedValue(null);
    const action = await getHandler();

    await expect(action.handler(action.inputSchema.parse(input), ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Tenant email settings not configured',
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('fails visibly when no email provider is enabled', async () => {
    getAvailableProvidersMock.mockResolvedValue([]);
    const action = await getHandler();

    await expect(action.handler(action.inputSchema.parse(input), ctx)).rejects.toMatchObject({
      message: 'No enabled email provider configured',
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
