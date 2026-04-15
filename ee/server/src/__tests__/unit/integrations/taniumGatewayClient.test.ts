import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayPostMock = vi.fn();
const assetGetMock = vi.fn();
const axiosCreateMock = vi.fn((config: any) => {
  if (String(config?.baseURL || '').includes('/plugin/products/asset')) {
    return {
      get: assetGetMock,
    };
  }

  return {
    post: gatewayPostMock,
  };
});

const isAxiosErrorMock = vi.fn((error: unknown) => Boolean((error as any)?.isAxiosError));

vi.mock('axios', () => ({
  default: {
    create: (...args: any[]) => axiosCreateMock(...args),
    isAxiosError: (...args: any[]) => isAxiosErrorMock(...args),
  },
}));

import { TaniumGatewayClient } from '../../../lib/integrations/tanium/taniumGatewayClient';

describe('TaniumGatewayClient', () => {
  beforeEach(() => {
    gatewayPostMock.mockReset();
    assetGetMock.mockReset();
    axiosCreateMock.mockClear();
    isAxiosErrorMock.mockClear();
  });

  it('uses the Tanium session header for Gateway and Asset API requests', () => {
    new TaniumGatewayClient({
      gatewayUrl: 'https://tk-nineminds.titankube.com/plugin/products/gateway',
      apiToken: 'token-valid',
      assetApiUrl: 'https://tk-nineminds.titankube.com/plugin/products/asset',
    });

    expect(axiosCreateMock).toHaveBeenCalledTimes(2);
    expect(axiosCreateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        headers: expect.objectContaining({
          session: 'token-valid',
          'Content-Type': 'application/json',
        }),
      })
    );
    expect(axiosCreateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        headers: expect.objectContaining({
          session: 'token-valid',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('fails fast when the configured API token is missing the token prefix', () => {
    expect(
      () =>
        new TaniumGatewayClient({
          gatewayUrl: 'https://tk-nineminds.titankube.com/plugin/products/gateway',
          apiToken: 'not-a-token',
        })
    ).toThrow(/token- prefix/i);
  });

  it('fails fast when Gateway redirects to authentication', async () => {
    gatewayPostMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 302,
        headers: {
          location: 'https://auth.titankube.com/realms/partners/protocol/openid-connect/auth',
        },
      },
    });

    const client = new TaniumGatewayClient({
      gatewayUrl: 'https://tk-nineminds.titankube.com/plugin/products/gateway',
      apiToken: 'token-valid',
    });

    await expect(client.testConnection()).rejects.toThrow(/redirected to authentication/i);
  });

  it('fails fast when Gateway returns a non-GraphQL response body', async () => {
    gatewayPostMock.mockResolvedValue({
      headers: { 'content-type': 'text/html' },
      data: '<!doctype html><html><body>login</body></html>',
    });

    const client = new TaniumGatewayClient({
      gatewayUrl: 'https://tk-nineminds.titankube.com/plugin/products/gateway',
      apiToken: 'token-valid',
    });

    await expect(client.testConnection()).rejects.toThrow(/non-graphql response/i);
  });

  it('uses Cursor pagination for computer group queries', async () => {
    gatewayPostMock.mockResolvedValue({
      headers: { 'content-type': 'application/json' },
      data: {
        data: {
          computerGroups: {
            edges: [{ node: { id: '30229', name: 'Nine Minds' } }],
            pageInfo: { hasNextPage: false, endCursor: 'abc' },
          },
        },
      },
    });

    const client = new TaniumGatewayClient({
      gatewayUrl: 'https://tk-nineminds.titankube.com/plugin/products/gateway',
      apiToken: 'token-valid',
    });

    const groups = await client.listComputerGroups();

    expect(groups).toEqual([{ id: '30229', name: 'Nine Minds' }]);
    const [path, body] = gatewayPostMock.mock.calls[0] || [];
    expect(path).toBe('/graphql');
    expect(body?.query).toContain('$after: Cursor');
    expect(body?.variables).toEqual({ first: 250, after: null });
  });

  it('queries endpoints with Tanium-supported enrichment fields and memberOf filter', async () => {
    gatewayPostMock
      .mockResolvedValueOnce({
        headers: { 'content-type': 'application/json' },
        data: {
          data: {
            endpoints: {
              edges: [
                {
                  node: {
                    id: 'endpoint-1',
                    name: 'MacBook Pro',
                    serialNumber: 'SER-123',
                    manufacturer: 'Apple',
                    model: 'Mac16,5',
                    chassisType: 'Laptop',
                    domainName: 'No Domain',
                    eidLastSeen: '2026-04-15T17:07:13Z',
                    ipAddress: '192.168.254.190',
                    ipAddresses: ['192.168.254.190', 'fe80::1'],
                    macAddresses: ['84:2f:57:ab:d8:bd'],
                    primaryUser: { name: 'Error: No inventory has been collected' },
                    lastLoggedInUser: 'roberisaacs',
                    reportingConsoleURL: 'https://tk.example/reporting',
                    isVirtual: false,
                    isEncrypted: true,
                    os: { name: 'macOS (26.3.1 (a))', generation: 'macOS 26.3', platform: 'Mac' },
                    memory: { total: '48 GB' },
                    processor: { cpu: 'Apple M4 Max 2.4GHz', logicalProcessors: 16 },
                    disks: [{ name: '/', free: '20G', total: '995G', usedPercentage: '39%' }],
                    discover: { natIpAddress: '10.0.156.6' },
                    networking: {
                      dnsServers: ['127.0.2.2'],
                      adapters: [{ name: 'Wi-Fi', manufacturer: 'Apple', type: 'AirPort', macAddress: '84:2f:57:ab:d8:bd', speed: 'unknown', connectionId: 'en0' }],
                      wirelessAdapters: [{ ssid: 'Frontier0822_6G', state: 'CONNECTED' }],
                    },
                    installedApplications: [{ name: 'Docker Desktop', version: '4.40.0', uninstallable: true }],
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: 'abc' },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        headers: { 'content-type': 'application/json' },
        data: {
          data: {
            endpoints: {
              edges: [
                {
                  node: {
                    id: 'endpoint-1',
                    lastReboot: { values: ['Sat, 11 Apr 2026 21:50:13 -0400'] },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: 'def' },
            },
          },
        },
      });

    const client = new TaniumGatewayClient({
      gatewayUrl: 'https://tk-nineminds.titankube.com/plugin/products/gateway',
      apiToken: 'token-valid',
    });

    const endpoints = await client.listEndpoints({ computerGroupId: '30229' });

    expect(endpoints).toEqual([
      {
        id: 'endpoint-1',
        name: 'MacBook Pro',
        computerGroupId: '30229',
        serialNumber: 'SER-123',
        lastSeen: '2026-04-15T17:07:13Z',
        online: null,
        osName: 'macOS (26.3.1 (a))',
        osVersion: 'macOS 26.3',
        currentUser: 'roberisaacs',
        ipAddress: '192.168.254.190',
        wanIpAddress: '10.0.156.6',
        manufacturer: 'Apple',
        model: 'Mac16,5',
        cpuModel: 'Apple M4 Max 2.4GHz',
        cpuLogicalProcessors: 16,
        memoryTotalGb: 48,
        lastRebootAt: 'Sat, 11 Apr 2026 21:50:13 -0400',
        diskUsage: [{ name: '/', free_gb: 20, total_gb: 995, utilization_percent: 39 }],
        installedApplications: [{ name: 'Docker Desktop', version: '4.40.0', uninstallable: true }],
        metadata: {
          manufacturer: 'Apple',
          model: 'Mac16,5',
          chassisType: 'Laptop',
          domainName: 'No Domain',
          reportingConsoleURL: 'https://tk.example/reporting',
          isVirtual: false,
          isEncrypted: true,
          ipAddresses: ['192.168.254.190', 'fe80::1'],
          macAddresses: ['84:2f:57:ab:d8:bd'],
          dnsServers: ['127.0.2.2'],
          networkAdapters: [{ name: 'Wi-Fi', manufacturer: 'Apple', type: 'AirPort', macAddress: '84:2f:57:ab:d8:bd', speed: 'unknown', connectionId: 'en0' }],
          wirelessAdapters: [{ ssid: 'Frontier0822_6G', state: 'CONNECTED' }],
          uptimeSeconds: expect.any(Number),
        },
      },
    ]);
    const [path, body] = gatewayPostMock.mock.calls[0] || [];
    expect(path).toBe('/graphql');
    expect(body?.query).toContain('manufacturer');
    expect(body?.query).toContain('installedApplications');
    expect(body?.query).toContain('discover');
    expect(body?.variables).toEqual({
      first: 250,
      after: null,
      filter: {
        memberOf: { id: '30229' },
        op: 'EQ',
        negated: false,
        any: false,
      },
    });
    expect(gatewayPostMock.mock.calls[1]?.[1]?.query).toContain('Last Reboot');
  });

  it('requires the connection probe to return computerGroups data', async () => {
    gatewayPostMock.mockResolvedValue({
      headers: { 'content-type': 'application/json' },
      data: {
        data: {},
      },
    });

    const client = new TaniumGatewayClient({
      gatewayUrl: 'https://tk-nineminds.titankube.com/plugin/products/gateway',
      apiToken: 'token-valid',
    });

    await expect(client.testConnection()).rejects.toThrow(/failed to return computer groups/i);
  });
});
