import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = vi.hoisted(() => ({ getAgentMeshCentralLinks: vi.fn() }));
vi.mock('./buildClient', () => ({ buildTacticalClientForTenant: vi.fn(async () => mockClient) }));
vi.mock('./syncSingleAgent', () => ({ syncTacticalSingleAgentForTenant: vi.fn() }));

import { tacticalRmmAssetDeviceActions } from './assetDeviceActions';

const ref = { tenant: 'tenant-1', assetId: 'asset-1', deviceId: 'agent/1', assetName: 'Host' };

describe('Tactical RMM remote control URLs', () => {
  beforeEach(() => mockClient.getAgentMeshCentralLinks.mockReset());

  it('maps control to splashtop and terminal to shell', async () => {
    mockClient.getAgentMeshCentralLinks.mockResolvedValue({
      control: 'https://mesh/control',
      terminal: 'https://mesh/terminal',
    });
    await expect(tacticalRmmAssetDeviceActions.remoteControlUrl?.(ref, 'splashtop'))
      .resolves.toBe('https://mesh/control');
    await expect(tacticalRmmAssetDeviceActions.remoteControlUrl?.(ref, 'shell'))
      .resolves.toBe('https://mesh/terminal');
    expect(mockClient.getAgentMeshCentralLinks).toHaveBeenCalledWith('agent/1');
  });

  it('returns only types that have a non-empty MeshCentral link', async () => {
    mockClient.getAgentMeshCentralLinks.mockResolvedValue({ control: 'https://mesh/control', terminal: '' });
    await expect(tacticalRmmAssetDeviceActions.remoteControlTypes?.(ref)).resolves.toEqual(['splashtop']);
  });

  it('returns a clear error when the requested link is missing', async () => {
    mockClient.getAgentMeshCentralLinks.mockResolvedValue({ control: null, terminal: undefined });
    await expect(tacticalRmmAssetDeviceActions.remoteControlUrl?.(ref, 'splashtop'))
      .rejects.toThrow('Tactical RMM did not return a Take Control link for this agent.');
  });

  it('returns null for unsupported types without calling the API', async () => {
    await expect(tacticalRmmAssetDeviceActions.remoteControlUrl?.(ref, 'vnc')).resolves.toBeNull();
    expect(mockClient.getAgentMeshCentralLinks).not.toHaveBeenCalled();
  });
});
