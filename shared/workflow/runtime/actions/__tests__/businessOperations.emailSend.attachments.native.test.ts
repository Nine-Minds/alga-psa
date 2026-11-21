import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// email.send attachments are judged by the storage provider's allowlist (validateFileUpload, the
// real shared policy: `@alga-psa/storage/config/storage` is deliberately not mocked), through the
// real action handler with a fake email provider and fake storage.

const registered: Record<string, any> = {};
vi.mock('../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({ register: (action: any) => { registered[action.id] = action; } }),
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ tenantId: 'tenant-1', actorUserId: 'user-1', trx: {} }),
    requirePermission: vi.fn(async () => undefined),
    writeRunAudit: vi.fn(async () => undefined),
  };
});

const storageDownload = vi.fn(async (_path: string) => Buffer.from('%PDF-1.4 ...'));
vi.mock('@alga-psa/storage/StorageProviderFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/storage/StorageProviderFactory')>();
  return { ...actual, StorageProviderFactory: { createProvider: vi.fn(async () => ({ download: storageDownload })) } };
});

const fileRows = new Map<string, Record<string, unknown>>();
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({
      where: (criteria: { file_id: string }) => ({ first: async () => fileRows.get(criteria.file_id) }),
    }),
  }),
}));

const sendEmail = vi.fn(async (_args: unknown) => ({ success: true, messageId: 'm-1', providerId: 'p-1', providerType: 'smtp' }));

import { registerWorkflowEmailProvider, resetWorkflowEmailProvider } from '../../registries/workflowEmailRegistry';
import { clearCachedStorageConfig } from '@alga-psa/storage/config/storage';
import { registerEmailActions } from '../businessOperations/email';

const FILE_ID = '33333333-3333-4333-8333-333333333333';
const ctx = { tenantId: 'tenant-1', stepPath: 'step-1', runId: 'run-1' } as any;

function installEmailProvider() {
  class EmailProviderManager {
    async initialize() {}
    async getAvailableProviders() {
      return [{ capabilities: { supportsAttachments: true, maxAttachmentSize: 25 * 1024 * 1024, maxRecipientsPerMessage: 50 } }];
    }
  }
  class StaticTemplateProcessor {
    constructor(private subject: string, private html: string, private text?: string) {}
    async process() { return { subject: this.subject, html: this.html, text: this.text }; }
  }
  registerWorkflowEmailProvider({
    TenantEmailService: {
      getTenantEmailSettings: async () => ({ providerConfigs: [], outboundSenders: [] }),
      getInstance: () => ({ sendEmail }),
    },
    StaticTemplateProcessor,
    EmailProviderManager,
  } as any);
}

function sendWithAttachment() {
  return registered['email.send'].handler(
    registered['email.send'].inputSchema.parse({
      to: [{ email: 'someone@example.com' }],
      subject: 'Report',
      text: 'attached',
      attachment_file_ids: [FILE_ID],
    }),
    ctx,
  );
}

beforeEach(() => {
  for (const key of Object.keys(registered)) delete registered[key];
  fileRows.clear();
  sendEmail.mockClear();
  storageDownload.mockClear();
  installEmailProvider();
  registerEmailActions();
});

afterEach(() => {
  resetWorkflowEmailProvider();
  vi.unstubAllEnvs();
  clearCachedStorageConfig();
});

describe('email.send attachments use the provider allowlist', () => {
  const stored = (mime: string | null, extra: Record<string, unknown> = {}) =>
    fileRows.set(FILE_ID, { file_id: FILE_ID, file_name: 'x', original_name: 'report.pdf', mime_type: mime, file_size: 12, storage_path: 'tenant-1/report.pdf', ...extra });

  it('rejects the send when the provider disallows the attachment type, and sends nothing', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'text/plain');
    clearCachedStorageConfig();
    stored('application/pdf');

    await expect(sendWithAttachment()).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'File type not allowed' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends when the type is allowed, with the attachment content and type', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf');
    clearCachedStorageConfig();
    stored('application/pdf');

    await expect(sendWithAttachment()).resolves.toMatchObject({ success: true, status: 'sent', message_id: 'm-1' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0]![0] as any).attachments).toEqual([
      expect.objectContaining({ filename: 'report.pdf', contentType: 'application/pdf', content: expect.any(Buffer) }),
    ]);
  });

  it('matches the allowlist case-insensitively and ignoring ; parameters', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf');
    clearCachedStorageConfig();
    stored('Application/PDF; name=report.pdf');

    await expect(sendWithAttachment()).resolves.toMatchObject({ status: 'sent' });
  });

  it('a row with no recorded type is sniffed from its bytes rather than refused as octet-stream', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf');
    clearCachedStorageConfig();
    stored(null);
    storageDownload.mockResolvedValueOnce(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 32)]));

    await expect(sendWithAttachment()).resolves.toMatchObject({ status: 'sent' });
    expect((sendEmail.mock.calls[0]![0] as any).attachments[0].contentType).toBe('application/pdf');
  });

  it('a row with no recorded type and unrecognisable bytes is refused unless octet-stream is allowed', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf');
    clearCachedStorageConfig();
    stored(null);
    storageDownload.mockResolvedValueOnce(Buffer.from('opaque bytes'));

    await expect(sendWithAttachment()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
