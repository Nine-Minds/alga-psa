import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(async () => ({ jobId: 'job-1', scheduledJobId: null })),
  config: vi.fn(async (): Promise<{ config: unknown } | null> => null),
  active: vi.fn((config: any) => Boolean(config?.phonebook?.enabled)),
  subscribe: vi.fn(async () => undefined),
  unsubscribe: vi.fn(async () => undefined),
  edition: { ee: true },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/core', () => ({ enqueueImmediateJob: mocks.enqueue }));
vi.mock('@/lib/features', () => ({ isEnterpriseEdition: () => mocks.edition.ee }));
vi.mock('../../lib/eventBus/index', () => ({
  getEventBus: () => ({ subscribe: mocks.subscribe, unsubscribe: mocks.unsubscribe }),
}));
vi.mock('@alga-psa/ee-threecx/lib', () => ({
  getThreecxProviderConfig: mocks.config,
  isThreecxPhonebookActive: mocks.active,
}));

import {
  handleThreecxPhonebookContactEvent,
  registerThreecxPhonebookSubscriber,
  THREECX_PHONEBOOK_CONTACT_JOB,
  THREECX_PHONEBOOK_EVENT_TYPES,
} from '../../lib/eventBus/subscribers/threecxPhonebookSubscriber';

const enabledConfig = { config: { phonebook: { enabled: true } } };
const contactUpdated = { payload: { tenantId: 'tenant-1', contactId: 'contact-1' } };

describe('threecxPhonebookSubscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.edition.ee = true;
    mocks.config.mockResolvedValue(null);
  });

  it('T117: CONTACT_UPDATED enqueues sync-threecx-phonebook-contact for an enabled connected tenant', async () => {
    mocks.config.mockResolvedValue(enabledConfig);

    await handleThreecxPhonebookContactEvent(contactUpdated);

    expect(mocks.enqueue).toHaveBeenCalledWith(THREECX_PHONEBOOK_CONTACT_JOB, {
      tenantId: 'tenant-1',
      contactId: 'contact-1',
    });
  });

  it('T118: CONTACT_UPDATED enqueues nothing when sync is disabled', async () => {
    mocks.config.mockResolvedValue({ config: { phonebook: { enabled: false } } });

    await handleThreecxPhonebookContactEvent(contactUpdated);

    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues nothing when the tenant has no 3CX row or the payload lacks ids', async () => {
    await handleThreecxPhonebookContactEvent(contactUpdated);
    await handleThreecxPhonebookContactEvent({ payload: { tenantId: 'tenant-1' } });

    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('is inert outside Enterprise Edition', async () => {
    mocks.edition.ee = false;
    mocks.config.mockResolvedValue(enabledConfig);

    await handleThreecxPhonebookContactEvent(contactUpdated);
    await registerThreecxPhonebookSubscriber();

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('F072: registers the four contact lifecycle events', async () => {
    await registerThreecxPhonebookSubscriber();

    expect(mocks.subscribe.mock.calls.map((call: any[]) => call[0])).toEqual(THREECX_PHONEBOOK_EVENT_TYPES);
    expect(THREECX_PHONEBOOK_EVENT_TYPES).toEqual([
      'CONTACT_CREATED',
      'CONTACT_UPDATED',
      'CONTACT_ARCHIVED',
      'CONTACT_DELETED',
    ]);
  });
});
