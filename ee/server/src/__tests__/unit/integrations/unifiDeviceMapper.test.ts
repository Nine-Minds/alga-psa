import { describe, expect, it } from 'vitest';
import {
  classifyUniFiState,
  deriveDeviceKind,
  mapDeviceKindToNetworkType,
  mapUniFiDeviceToSnapshot,
  normalizeMac,
  resolveExternalDeviceId,
  severityForKind,
} from '../../../lib/integrations/unifi/mappers/deviceMapper';
import type { UniFiDevice } from '../../../lib/integrations/unifi/unifiApiClient';

function device(overrides: Partial<UniFiDevice> = {}): UniFiDevice {
  return {
    id: 'dev-1',
    macAddress: 'AA-BB-CC-DD-EE-FF',
    ipAddress: '10.0.0.2',
    name: 'Core Switch',
    model: 'USW-24-PoE',
    serialNumber: null,
    state: 'ONLINE',
    firmwareVersion: '7.0.1',
    firmwareUpdatable: false,
    features: ['switching'],
    uplinkDeviceId: 'gw-1',
    stateChangedAt: null,
    raw: {},
    ...overrides,
  } as UniFiDevice;
}

describe('unifi device mapper', () => {
  it('normalizes MACs to lowercase colon-separated, rejecting malformed input', () => {
    expect(normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeMac('aabb.ccdd.eeff')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeMac('nope')).toBeNull();
    expect(normalizeMac(null)).toBeNull();
  });

  it('classifies states', () => {
    expect(classifyUniFiState('ONLINE')).toBe('online');
    expect(classifyUniFiState('offline')).toBe('offline');
    expect(classifyUniFiState('UPDATING')).toBe('transitional');
    expect(classifyUniFiState('PENDING_ADOPTION')).toBe('not_adopted');
    expect(classifyUniFiState('SOMETHING_NEW')).toBe('unknown');
    expect(classifyUniFiState(undefined)).toBe('unknown');
  });

  it('derives kind, network type and severity', () => {
    expect(deriveDeviceKind({ model: 'UDM-Pro', features: [] })).toBe('gateway');
    expect(deriveDeviceKind({ model: 'USW-Lite-8', features: ['switching'] })).toBe('switch');
    expect(deriveDeviceKind({ model: 'U6-Pro', features: ['accessPoint'] })).toBe('access_point');
    expect(deriveDeviceKind({ model: 'UP-Sense', features: [] })).toBeNull();
    expect(mapDeviceKindToNetworkType('gateway', 'UDM-Pro')).toBe('firewall');
    expect(mapDeviceKindToNetworkType('switch', 'USW-24')).toBe('switch');
    expect(severityForKind('gateway')).toBe('critical');
    expect(severityForKind('switch')).toBe('major');
    expect(severityForKind('access_point')).toBe('moderate');
  });

  it('falls back to the normalized MAC when the device has no id', () => {
    expect(resolveExternalDeviceId({ id: null, macAddress: 'AA-BB-CC-DD-EE-FF' })).toBe('aa:bb:cc:dd:ee:ff');
    expect(resolveExternalDeviceId({ id: 'x', macAddress: null })).toBe('x');
  });

  it('maps an online switch into a network_device snapshot', () => {
    const snap = mapUniFiDeviceToSnapshot({ integrationId: 'int-1', device: device(), scopeKey: 'h:s', siteName: 'HQ' })!;
    expect(snap.assetType).toBe('network_device');
    expect(snap.externalDeviceId).toBe('dev-1');
    expect(snap.externalScopeId).toBe('h:s');
    expect(snap.lifecycleState).toBe('active');
    expect(snap.extension?.networkDevice).toMatchObject({ deviceType: 'switch', managementIp: '10.0.0.2', firmwareVersion: '7.0.1' });
    expect(snap.assetTag).toBe('unifi:dev-1');
  });

  it('marks offline devices offline and skips pending-adoption and unsupported hardware', () => {
    const off = mapUniFiDeviceToSnapshot({ integrationId: 'i', device: device({ state: 'OFFLINE' }), scopeKey: 'h:s' })!;
    expect(off.lifecycleState).toBe('offline');
    expect(off.agentStatus).toBe('offline');
    expect(mapUniFiDeviceToSnapshot({ integrationId: 'i', device: device({ state: 'PENDING_ADOPTION' }), scopeKey: 'h:s' })).toBeNull();
    expect(mapUniFiDeviceToSnapshot({ integrationId: 'i', device: device({ model: 'UP-Sense', features: [] }), scopeKey: 'h:s' })).toBeNull();
    expect(mapUniFiDeviceToSnapshot({ integrationId: 'i', device: device({ id: null, macAddress: null }), scopeKey: 'h:s' })).toBeNull();
  });
});
