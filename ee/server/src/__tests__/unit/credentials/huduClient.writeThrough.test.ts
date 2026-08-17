/**
 * HuduClient write-through methods (create/update/delete asset_password) against
 * a mocked axios instance: request method/url/data shape, response echo, and
 * typed error mapping (no retry for 4xx). Extends the huduClient.test.ts mock
 * idiom.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosCreateMock = vi.fn();
const axiosIsAxiosErrorMock = vi.fn((e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError));
const requestMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: axiosCreateMock,
    isAxiosError: axiosIsAxiosErrorMock,
  },
  create: axiosCreateMock,
  isAxiosError: axiosIsAxiosErrorMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const getTenantSecretMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn(async () => ({
  getTenantSecret: getTenantSecretMock,
  getAppSecret: vi.fn(),
  setTenantSecret: vi.fn(),
  deleteTenantSecret: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock,
}));

const VALID_CREDS = { apiKey: 'super-secret-key', baseUrl: 'https://acme.huducloud.com' };
const noopSleep = async () => {};

function axiosError(status: number) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, headers: {}, data: {} },
  };
}

async function importClient() {
  return import('@ee/lib/integrations/hudu/huduClient');
}

function createdRecord() {
  return {
    asset_password: {
      id: 42,
      company_id: 101,
      name: 'Domain Admin',
      username: 'admin@example.com',
      password: 'plain-echo',
      otp_secret: null,
      url: '/passwords/42',
      description: null,
      password_folder_name: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  axiosCreateMock.mockReset();
  requestMock.mockReset();
  getTenantSecretMock.mockReset();
  axiosIsAxiosErrorMock.mockImplementation((e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError));
  axiosCreateMock.mockReturnValue({ request: requestMock });
});

describe('HuduClient — create/update/delete asset_password', () => {
  it('creates via POST /asset_passwords with the value-bearing payload', async () => {
    requestMock.mockResolvedValue({ data: createdRecord() });
    const { HuduClient } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    const result = await client.createAssetPassword({
      company_id: 101,
      name: 'Domain Admin',
      username: 'admin@example.com',
      password: 'plain-echo',
      otp_secret: 'JBSWY3DPEHPK3PXP',
      url: 'https://portal.example.com',
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    const call = requestMock.mock.calls[0][0];
    expect(call.method).toBe('post');
    expect(call.url).toBe('/asset_passwords');
    expect(call.data).toEqual({
      asset_password: {
        company_id: 101,
        name: 'Domain Admin',
        username: 'admin@example.com',
        password: 'plain-echo',
        otp_secret: 'JBSWY3DPEHPK3PXP',
        url: 'https://portal.example.com',
      },
    });
    expect(result).toMatchObject({ id: 42, company_id: 101 });
  });

  it('updates via PUT /asset_passwords/:id with a partial payload', async () => {
    requestMock.mockResolvedValue({ data: createdRecord() });
    const { HuduClient } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    const result = await client.updateAssetPassword(42, { name: 'Renamed', password: 'new-val' });

    const call = requestMock.mock.calls[0][0];
    expect(call.method).toBe('put');
    expect(call.url).toBe('/asset_passwords/42');
    expect(call.data).toEqual({ asset_password: { name: 'Renamed', password: 'new-val' } });
    expect(result.id).toBe(42);
  });

  it('deletes via DELETE /asset_passwords/:id', async () => {
    requestMock.mockResolvedValue({ data: {} });
    const { HuduClient } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    await client.deleteAssetPassword(42);

    const call = requestMock.mock.calls[0][0];
    expect(call.method).toBe('delete');
    expect(call.url).toBe('/asset_passwords/42');
  });

  it('maps a 403 no_password_access write error (no retry for 4xx)', async () => {
    requestMock.mockRejectedValue(axiosError(403));
    const { HuduClient, HuduRequestError } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    await expect(
      client.createAssetPassword({ company_id: 101, name: 'X' })
    ).rejects.toBeInstanceOf(HuduRequestError);
    await expect(
      client.createAssetPassword({ company_id: 101, name: 'X' }).catch((error: unknown) => error)
    ).resolves.toMatchObject({ hudu: { kind: 'no_password_access' } });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('maps a 422 validation write error', async () => {
    requestMock.mockRejectedValue(axiosError(422));
    const { HuduClient, HuduRequestError } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    await expect(client.updateAssetPassword(42, { name: '' })).rejects.toBeInstanceOf(HuduRequestError);
    const error = (await client.updateAssetPassword(42, { name: '' }).catch((e: unknown) => e)) as {
      hudu: { kind: string };
    };
    expect(error.hudu.kind).toBe('validation');
  });

  it('maps a 404 delete to not_found', async () => {
    requestMock.mockRejectedValue(axiosError(404));
    const { HuduClient, HuduRequestError } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    await expect(client.deleteAssetPassword(999)).rejects.toBeInstanceOf(HuduRequestError);
    const error = (await client.deleteAssetPassword(999).catch((e: unknown) => e)) as {
      hudu: { kind: string };
    };
    expect(error.hudu.kind).toBe('not_found');
  });

  it('does NOT retry a create POST on 500 — the request may have been accepted server-side, so a blind retry must not risk a duplicate record', async () => {
    // First attempt "succeeds" server-side but the response is lost (500).
    requestMock.mockRejectedValueOnce(axiosError(500));
    const { HuduClient, HuduRequestError } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    const error = (await client
      .createAssetPassword({ company_id: 101, name: 'No Dup 500' })
      .catch((e: unknown) => e)) as { hudu: { kind: string }; message: string };

    expect(error).toBeInstanceOf(HuduRequestError);
    expect(error.hudu.kind).toBe('server_error');
    // The surfaced error is explicit that no retry happened and a duplicate
    // must be avoided.
    expect(error.message).toMatch(/NOT retried to avoid a duplicate/);

    // Exactly ONE POST reached the wire — the second mocked success was never
    // consumed because the client refused to re-send.
    expect(requestMock).toHaveBeenCalledTimes(1);
    const call = requestMock.mock.calls[0][0];
    expect(call.method).toBe('post');
  });

  it('does NOT retry a create POST on a network error (timeout) — the record may have been created server-side', async () => {
    requestMock.mockRejectedValueOnce({ isAxiosError: true, message: 'timeout of 30000ms exceeded', code: 'ECONNABORTED' });
    const { HuduClient, HuduRequestError } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    const error = (await client
      .createAssetPassword({ company_id: 101, name: 'No Dup Timeout' })
      .catch((e: unknown) => e)) as { hudu: { kind: string }; message: string };

    expect(error).toBeInstanceOf(HuduRequestError);
    expect(error.hudu.kind).toBe('network_error');
    expect(error.message).toMatch(/NOT retried to avoid a duplicate/);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('still retries a create POST on 429 — a rate-limit rejection happens BEFORE the request is accepted, so no duplicate is possible', async () => {
    requestMock
      .mockRejectedValueOnce(axiosError(429))
      .mockRejectedValueOnce(axiosError(429))
      .mockResolvedValueOnce({ data: createdRecord() });
    const { HuduClient } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    const result = await client.createAssetPassword({ company_id: 101, name: 'Retry 429' });

    // Three attempts total (two 429s then success) — POST is safe to retry on 429.
    expect(requestMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ id: 42, company_id: 101 });
  });

  it('keeps GET retry behavior unchanged (transient 500 retried, then succeeds)', async () => {
    requestMock.mockRejectedValueOnce(axiosError(500)).mockResolvedValueOnce({ data: { asset_password: createdRecord().asset_password } });
    const { HuduClient } = await importClient();
    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    const result = await client.getAssetPassword(42);

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ id: 42, company_id: 101 });
  });
});
