import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: mocks.logger,
}));

import { setEmailProviderConnectionStatus } from '@alga-psa/shared/services/email/emailProviderConnectionStatus';

const PROVIDER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';

describe('setEmailProviderConnectionStatus', () => {
  let row: { status: string; error_message: string | null };
  let update: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    row = { status: 'connected', error_message: null };
    update = vi.fn().mockImplementation(async (values: any) => {
      row.status = values.status;
      row.error_message = values.error_message;
      return 1;
    });
    const query = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(async () => ({ ...row })),
      update,
    };
    const knex: any = vi.fn(() => query);
    knex.fn = { now: vi.fn(() => new Date()) };
    knex.raw = vi.fn((sql: string) => sql);
    mocks.getAdminConnection.mockResolvedValue(knex);
  });

  const setStatus = (status: 'connected' | 'error', errorMessage: string | null) =>
    setEmailProviderConnectionStatus({ providerId: PROVIDER_ID, tenant: TENANT, status, errorMessage });

  it('emits one unhealthy event on the transition into error, not on repeats', async () => {
    await setStatus('error', 'Error in connect: Request failed with status code 403');
    await setStatus('error', 'Error in connect: Request failed with status code 403');

    const events = mocks.logger.error.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes('event=microsoft_email_provider_unhealthy'));
    expect(events).toEqual([
      `event=microsoft_email_provider_unhealthy provider_id=${PROVIDER_ID} failure_category=maintenance_failure`,
    ]);
  });

  it('emits a recovered event when an errored provider reconnects', async () => {
    row = { status: 'error', error_message: 'boom' };

    await setStatus('connected', null);

    expect(mocks.logger.info).toHaveBeenCalledWith(
      `event=microsoft_email_provider_recovered provider_id=${PROVIDER_ID}`
    );
    expect(row.status).toBe('connected');
    expect(row.error_message).toBeNull();
  });

  it('skips the write entirely for a no-change healthy observation', async () => {
    await setStatus('connected', null);

    expect(update).not.toHaveBeenCalled();
    expect(mocks.logger.info).not.toHaveBeenCalled();
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });
});
