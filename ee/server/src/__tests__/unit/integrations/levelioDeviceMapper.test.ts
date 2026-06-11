import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGroupParentMap,
  buildGroupPath,
  extractLanIp,
  mapLevelIoDeviceToSnapshot,
  mapLevelIoDiskUsage,
  mapLevelIoSeverity,
  resolveDeepestMappedGroup,
} from '../../../lib/integrations/levelio/mappers/deviceMapper';
import type { LevelIoDevice, LevelIoGroup } from '../../../lib/integrations/levelio/levelApiClient';

const GROUPS: LevelIoGroup[] = [
  { id: 'g-root', parent_id: null, name: 'Acme Corp' },
  { id: 'g-site', parent_id: 'g-root', name: 'Branch Office' },
  { id: 'g-other', parent_id: null, name: 'Other MSP Client' },
];

function makeDevice(overrides: Partial<LevelIoDevice> = {}): LevelIoDevice {
  return {
    id: 'dev-1',
    hostname: 'WS-01',
    online: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mapLevelIoSeverity', () => {
  it('maps Level severities onto Alga severities', () => {
    expect(mapLevelIoSeverity('emergency')).toBe('critical');
    expect(mapLevelIoSeverity('critical')).toBe('major');
    expect(mapLevelIoSeverity('warning')).toBe('moderate');
    expect(mapLevelIoSeverity('information')).toBe('minor');
    expect(mapLevelIoSeverity('something-else')).toBe('none');
    expect(mapLevelIoSeverity(undefined)).toBe('none');
  });
});

describe('resolveDeepestMappedGroup', () => {
  const parentMap = buildGroupParentMap(GROUPS);

  it('prefers the device group itself when mapped', () => {
    expect(resolveDeepestMappedGroup('g-site', parentMap, new Set(['g-root', 'g-site']))).toBe('g-site');
  });

  it('walks up to the nearest mapped ancestor', () => {
    expect(resolveDeepestMappedGroup('g-site', parentMap, new Set(['g-root']))).toBe('g-root');
  });

  it('returns null when no ancestor is mapped', () => {
    expect(resolveDeepestMappedGroup('g-site', parentMap, new Set(['g-other']))).toBeNull();
    expect(resolveDeepestMappedGroup(null, parentMap, new Set(['g-root']))).toBeNull();
  });

  it('is safe against parent cycles', () => {
    const cyclic = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(resolveDeepestMappedGroup('a', cyclic, new Set(['zzz']))).toBeNull();
  });
});

describe('buildGroupPath', () => {
  it('renders the ancestor chain as a path', () => {
    const groupsById = new Map(GROUPS.map((g) => [g.id, g]));
    expect(buildGroupPath('g-site', groupsById)).toBe('Acme Corp / Branch Office');
    expect(buildGroupPath('g-root', groupsById)).toBe('Acme Corp');
  });
});

describe('extractLanIp', () => {
  it('skips virtual adapters and public IPs, returns the first private IPv4', () => {
    expect(
      extractLanIp([
        { description: 'Microsoft Wi-Fi Direct Virtual Adapter', ip_addresses: ['192.168.0.9'] },
        { description: 'Intel Ethernet', ip_addresses: ['8.8.8.8', '10.1.2.3'] },
      ])
    ).toBe('10.1.2.3');
    expect(extractLanIp([])).toBeNull();
    expect(extractLanIp(undefined)).toBeNull();
  });
});

describe('mapLevelIoDiskUsage', () => {
  it('converts partitions to RmmStorageInfo in GB with utilization', () => {
    const device = makeDevice({
      disk_partitions: [
        { mount_point: 'C:', size: 100 * 1024 ** 3, free_space: 25 * 1024 ** 3 },
        { label: 'no-size partition' },
      ],
    });

    expect(mapLevelIoDiskUsage(device)).toEqual([
      { name: 'C:', total_gb: 100, free_gb: 25, utilization_percent: 75 },
    ]);
  });
});

describe('mapLevelIoDeviceToSnapshot', () => {
  it('maps servers and domain controllers to server assets, everything else to workstations', () => {
    const base = { integrationId: 'int-1', scopeId: 'g-root' };
    expect(mapLevelIoDeviceToSnapshot({ ...base, device: makeDevice({ role: 'server' }) }).assetType).toBe('server');
    expect(mapLevelIoDeviceToSnapshot({ ...base, device: makeDevice({ role: 'domain_controller' }) }).assetType).toBe('server');
    expect(mapLevelIoDeviceToSnapshot({ ...base, device: makeDevice({ role: 'workstation' }) }).assetType).toBe('workstation');
    expect(mapLevelIoDeviceToSnapshot({ ...base, device: makeDevice({ role: null }) }).assetType).toBe('workstation');
  });

  it('maps identity, status, uptime, and cached live data', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));

    const device = makeDevice({
      nickname: 'Front Desk',
      serial_number: 'SN-123',
      online: true,
      last_seen_at: '2026-01-02T00:00:00.000Z',
      last_reboot_time: '2026-01-01T00:00:00.000Z',
      last_logged_in_user: 'jdoe',
      platform: 'Windows',
      operating_system: { full_operating_system: 'Windows 11', minor_version: '10.0.22631.3007' },
      total_memory: 16 * 1024 ** 3,
      cpu_cores: 8,
      cpus: [{ model: 'Intel i7', cores: 8 }],
      city: 'Asheville',
      country: 'United States',
      security: { antivirus_provider: 'Defender', antivirus_status: 'good', score: 90 },
    });

    const snapshot = mapLevelIoDeviceToSnapshot({
      integrationId: 'int-1',
      device,
      scopeId: 'g-root',
      pendingOsPatches: 4,
    });

    expect(snapshot.provider).toBe('levelio');
    expect(snapshot.externalDeviceId).toBe('dev-1');
    expect(snapshot.externalScopeId).toBe('g-root');
    expect(snapshot.displayName).toBe('Front Desk');
    expect(snapshot.serialNumber).toBe('SN-123');
    expect(snapshot.agentStatus).toBe('online');
    expect(snapshot.lifecycleState).toBe('active');
    expect(snapshot.location).toBe('Asheville, United States');
    expect(snapshot.assetTag).toBe('levelio:dev-1');
    expect(snapshot.extension?.uptimeSeconds).toBe(86400);
    expect(snapshot.extension?.osType).toBe('Windows');
    expect(snapshot.extension?.osVersion).toBe('10.0.22631.3007');
    expect(snapshot.extension?.currentUser).toBe('jdoe');
    expect(snapshot.extension?.cpuModel).toBe('Intel i7');
    expect(snapshot.extension?.cpuCores).toBe(8);
    expect(snapshot.extension?.ramGb).toBe(16);
    expect(snapshot.extension?.pendingOsPatches).toBe(4);
    expect(snapshot.extension?.antivirusProduct).toBe('Defender');
  });

  it('marks offline devices offline with no uptime', () => {
    const snapshot = mapLevelIoDeviceToSnapshot({
      integrationId: 'int-1',
      device: makeDevice({ online: false, last_reboot_time: '2026-01-01T00:00:00.000Z' }),
      scopeId: 'g-root',
    });

    expect(snapshot.agentStatus).toBe('offline');
    expect(snapshot.lifecycleState).toBe('offline');
    expect(snapshot.status).toBe('inactive');
    expect(snapshot.extension?.uptimeSeconds).toBeNull();
  });
});
