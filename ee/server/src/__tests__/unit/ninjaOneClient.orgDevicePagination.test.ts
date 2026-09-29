import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosCreateMock = vi.fn();
const axiosPostMock = vi.fn();
const axiosIsAxiosErrorMock = vi.fn(() => false);

vi.mock('axios', () => ({
  default: {
    create: axiosCreateMock,
    post: axiosPostMock,
    isAxiosError: axiosIsAxiosErrorMock,
  },
  create: axiosCreateMock,
  post: axiosPostMock,
  isAxiosError: axiosIsAxiosErrorMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildIntegrationTokenExpiringPayload: vi.fn(),
  buildIntegrationTokenRefreshFailedPayload: vi.fn(),
  getIntegrationTokenExpiringStatus: vi.fn(),
}));

const ORG_ID = 5;
const PAGE_SIZE = 100;

type MockedPage = {
  data: Array<Record<string, unknown>>;
  headers?: Record<string, string>;
};

function makeDevices(startId: number, count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    organizationId: ORG_ID,
    nodeClass: 'WINDOWS_WORKSTATION',
    offline: false,
    created: '2026-01-01T00:00:00Z',
  }));
}

async function createClientWithPages(pages: MockedPage[]) {
  const getMock = vi.fn();
  for (const page of pages) {
    getMock.mockResolvedValueOnce({ data: page.data, headers: page.headers ?? {} });
  }

  axiosCreateMock.mockReturnValue({
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    get: getMock,
    post: vi.fn(),
  });

  const { NinjaOneClient } = await import('@ee/lib/integrations/ninjaone/ninjaOneClient');
  const client = new NinjaOneClient({
    tenantId: 'tenant-pagination-test',
    instanceUrl: 'https://app.ninjarmm.com',
  });

  return { client, getMock };
}

describe('NinjaOneClient.getDevicesByOrganization pagination', () => {
  beforeEach(() => {
    vi.resetModules();
    axiosCreateMock.mockReset();
    axiosPostMock.mockReset();
    axiosIsAxiosErrorMock.mockReset();
    axiosIsAxiosErrorMock.mockReturnValue(false);
  });

  it('follows full headerless pages using the last device id as after and stops on the short page', async () => {
    const { client, getMock } = await createClientWithPages([
      { data: makeDevices(1, PAGE_SIZE) },
      { data: makeDevices(101, PAGE_SIZE) },
      { data: makeDevices(201, 20) },
    ]);

    const devices = await client.getDevicesByOrganization(ORG_ID);

    expect(devices).toHaveLength(220);
    expect(devices[0].id).toBe(1);
    expect(devices[219].id).toBe(220);
    // Provider order preserved across page boundaries
    expect(devices.map((device) => device.id)).toEqual(
      Array.from({ length: 220 }, (_, index) => index + 1)
    );

    expect(getMock).toHaveBeenCalledTimes(3);
    expect(getMock).toHaveBeenNthCalledWith(1, `/organization/${ORG_ID}/devices`, {
      params: { pageSize: PAGE_SIZE },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, `/organization/${ORG_ID}/devices`, {
      params: { pageSize: PAGE_SIZE, after: '100' },
    });
    expect(getMock).toHaveBeenNthCalledWith(3, `/organization/${ORG_ID}/devices`, {
      params: { pageSize: PAGE_SIZE, after: '200' },
    });
  });

  it('treats an empty first page as normal completion', async () => {
    const { client, getMock } = await createClientWithPages([{ data: [] }]);

    const devices = await client.getDevicesByOrganization(ORG_ID);

    expect(devices).toEqual([]);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('prefers a usable Link header cursor over the last device id', async () => {
    const { client, getMock } = await createClientWithPages([
      {
        data: makeDevices(1, PAGE_SIZE),
        headers: {
          link: `<https://app.ninjarmm.com/api/v2/organization/${ORG_ID}/devices?after=LINK_CURSOR&pageSize=${PAGE_SIZE}>; rel="next"`,
        },
      },
      { data: makeDevices(101, 5) },
    ]);

    const devices = await client.getDevicesByOrganization(ORG_ID);

    expect(devices).toHaveLength(105);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenNthCalledWith(2, `/organization/${ORG_ID}/devices`, {
      params: { pageSize: PAGE_SIZE, after: 'LINK_CURSOR' },
    });
  });

  it('rejects a full headerless page whose final device has no usable id', async () => {
    const fullPage = makeDevices(1, PAGE_SIZE);
    delete fullPage[PAGE_SIZE - 1].id;

    const { client, getMock } = await createClientWithPages([{ data: fullPage }]);

    await expect(client.getDevicesByOrganization(ORG_ID)).rejects.toThrow(
      /no usable pagination cursor/
    );
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a repeated last-id cursor instead of looping or truncating', async () => {
    const samePage = makeDevices(1, PAGE_SIZE);

    const { client, getMock } = await createClientWithPages([
      { data: samePage },
      { data: samePage },
    ]);

    await expect(client.getDevicesByOrganization(ORG_ID)).rejects.toThrow(
      /non-advancing cursor/
    );
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a repeated Link header cursor instead of looping', async () => {
    const link = `<https://app.ninjarmm.com/api/v2/organization/${ORG_ID}/devices?after=SAME_CURSOR&pageSize=${PAGE_SIZE}>; rel="next"`;

    const { client, getMock } = await createClientWithPages([
      { data: makeDevices(1, PAGE_SIZE), headers: { link } },
      { data: makeDevices(101, PAGE_SIZE), headers: { link } },
    ]);

    await expect(client.getDevicesByOrganization(ORG_ID)).rejects.toThrow(
      /non-advancing cursor/
    );
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
