import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenantScopes: [] as string[],
  config: vi.fn(async (): Promise<{ config: unknown } | null> => null),
  active: vi.fn((config: any) => Boolean(config?.phonebook?.enabled)),
  syncContact: vi.fn(async () => ({ created: 0, updated: 0, deleted: 1, imported: 0, skipped: 0 })),
  reconcile: vi.fn(async () => ({ ran: true })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (tenantId: string, fn: () => Promise<unknown>) => {
    mocks.tenantScopes.push(tenantId);
    return fn();
  },
}));
vi.mock('@alga-psa/ee-threecx/lib', () => ({
  getThreecxProviderConfig: mocks.config,
  isThreecxPhonebookActive: mocks.active,
  syncThreecxPhonebookContact: mocks.syncContact,
  reconcileThreecxPhonebook: mocks.reconcile,
}));

let handlers: typeof import('./threecxPhonebookHandlers');

beforeAll(async () => {
  process.env.EDITION = 'ee';
  handlers = await import('./threecxPhonebookHandlers');
});

describe('threecx phonebook job handlers', () => {
  beforeEach(() => {
    mocks.tenantScopes.length = 0;
    vi.clearAllMocks();
    mocks.config.mockResolvedValue({ config: { phonebook: { enabled: true } } });
  });

  it('exposes the job names the worker forwards', () => {
    expect(handlers.THREECX_PHONEBOOK_CONTACT_JOB).toBe('sync-threecx-phonebook-contact');
    expect(handlers.THREECX_PHONEBOOK_RECONCILE_JOB).toBe('reconcile-threecx-phonebook');
  });

  it('T119: sync-threecx-phonebook-contact pushes the single contact under tenant scope', async () => {
    await handlers.syncThreecxPhonebookContactHandler({ tenantId: 'tenant-1', contactId: 'contact-9' });

    expect(mocks.tenantScopes).toEqual(['tenant-1']);
    expect(mocks.syncContact).toHaveBeenCalledWith('tenant-1', 'contact-9');
  });

  it('skips the contact push when sync is no longer active', async () => {
    mocks.config.mockResolvedValue({ config: { phonebook: { enabled: false } } });

    await handlers.syncThreecxPhonebookContactHandler({ tenantId: 'tenant-1', contactId: 'contact-9' });

    expect(mocks.syncContact).not.toHaveBeenCalled();
  });

  it('F074: reconcile-threecx-phonebook delegates the due check and run to the lib', async () => {
    await handlers.reconcileThreecxPhonebookHandler({ tenantId: 'tenant-2' });

    expect(mocks.tenantScopes).toEqual(['tenant-2']);
    expect(mocks.reconcile).toHaveBeenCalledWith('tenant-2');
  });
});
