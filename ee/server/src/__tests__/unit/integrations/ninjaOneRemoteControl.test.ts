import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = vi.hoisted(() => ({ getDeviceLinks: vi.fn() }));
vi.mock('../../../lib/integrations/ninjaone/ninjaOneClient', () => ({ createNinjaOneClient: vi.fn(async () => mockClient) }));
vi.mock('../../../lib/integrations/ninjaone/sync/syncEngine', () => ({ syncSingleDeviceByAssetId: vi.fn() }));

import { ninjaOneAssetDeviceActions } from '../../../lib/integrations/ninjaone/assetDeviceActions';

const ref = { tenant: 'tenant-1', assetId: 'asset-1', deviceId: '42', assetName: 'Host' };

describe('NinjaOne remote control mapping', () => {
  beforeEach(() => mockClient.getDeviceLinks.mockReset());

  it('matches connection types case-insensitively and passes unknown types through', async () => {
    mockClient.getDeviceLinks.mockResolvedValue([
      { type: 'SPLASHTOP', url: 'https://ninja/desktop' },
      { type: 'Shell', url: 'https://ninja/shell' },
      { type: 'unknown', url: 'https://ninja/unknown' },
    ]);
    await expect(ninjaOneAssetDeviceActions.remoteControlTypes?.(ref))
      .resolves.toEqual(['splashtop', 'shell', 'unknown']);
    await expect(ninjaOneAssetDeviceActions.remoteControlUrl?.(ref, 'splashtop'))
      .resolves.toBe('https://ninja/desktop');
    await expect(ninjaOneAssetDeviceActions.remoteControlUrl?.(ref, 'shell'))
      .resolves.toBe('https://ninja/shell');
  });

  it('surfaces NINJAONE_REMOTE as ninjaone_remote and resolves its own URL', async () => {
    mockClient.getDeviceLinks.mockResolvedValue([
      { type: 'SPLASHTOP', url: 'https://ninja/desktop' },
      { type: 'NINJAONE_REMOTE', url: 'https://ninja/remote' },
    ]);
    await expect(ninjaOneAssetDeviceActions.remoteControlTypes?.(ref))
      .resolves.toEqual(['splashtop', 'ninjaone_remote']);
    await expect(ninjaOneAssetDeviceActions.remoteControlUrl?.(ref, 'ninjaone_remote'))
      .resolves.toBe('https://ninja/remote');
  });

  it('de-duplicates normalized types and keeps the provider order', async () => {
    mockClient.getDeviceLinks.mockResolvedValue([
      { type: 'RDP', url: 'https://ninja/rdp-1' },
      { type: 'rdp', url: 'https://ninja/rdp-2' },
      { type: 'Splashtop', url: 'https://ninja/desktop' },
      { type: '  ', url: 'https://ninja/blank' },
    ]);
    await expect(ninjaOneAssetDeviceActions.remoteControlTypes?.(ref))
      .resolves.toEqual(['rdp', 'splashtop']);
  });

  it('resolves the URL of an unknown type from its own link', async () => {
    mockClient.getDeviceLinks.mockResolvedValue([
      { type: 'SPLASHTOP', url: 'https://ninja/desktop' },
      { type: 'Fancy Remote', url: 'https://ninja/fancy' },
    ]);
    await expect(ninjaOneAssetDeviceActions.remoteControlUrl?.(ref, 'fancy_remote'))
      .resolves.toBe('https://ninja/fancy');
    await expect(ninjaOneAssetDeviceActions.remoteControlUrl?.(ref, 'nonexistent'))
      .resolves.toBeNull();
  });
});
