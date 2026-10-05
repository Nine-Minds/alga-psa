import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = vi.hoisted(() => ({ getDeviceLinks: vi.fn() }));
vi.mock('../../../lib/integrations/ninjaone/ninjaOneClient', () => ({ createNinjaOneClient: vi.fn(async () => mockClient) }));
vi.mock('../../../lib/integrations/ninjaone/sync/syncEngine', () => ({ syncSingleDeviceByAssetId: vi.fn() }));

import { ninjaOneAssetDeviceActions } from '../../../lib/integrations/ninjaone/assetDeviceActions';

const ref = { tenant: 'tenant-1', assetId: 'asset-1', deviceId: '42', assetName: 'Host' };

describe('NinjaOne remote control mapping', () => {
  beforeEach(() => mockClient.getDeviceLinks.mockReset());

  it('matches connection types case-insensitively and filters unknown types', async () => {
    mockClient.getDeviceLinks.mockResolvedValue([
      { type: 'SPLASHTOP', url: 'https://ninja/desktop' },
      { type: 'Shell', url: 'https://ninja/shell' },
      { type: 'unknown', url: 'https://ninja/unknown' },
    ]);
    await expect(ninjaOneAssetDeviceActions.remoteControlTypes?.(ref))
      .resolves.toEqual(['splashtop', 'shell']);
    await expect(ninjaOneAssetDeviceActions.remoteControlUrl?.(ref, 'splashtop'))
      .resolves.toBe('https://ninja/desktop');
    await expect(ninjaOneAssetDeviceActions.remoteControlUrl?.(ref, 'shell'))
      .resolves.toBe('https://ninja/shell');
  });
});
