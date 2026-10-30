import { describe, expect, it } from 'vitest';

import {
  dattoAgentStatusFor,
  dattoTimestampToIso,
  extractDattoOsFields,
  mapDattoDeviceAssetType,
  mapDattoDeviceToSnapshot,
  normalizeDattoAntivirusStatus,
} from '@ee/lib/integrations/datto/mappers';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const LAST_SEEN_MS = Date.parse('2026-10-19T11:55:00.000Z');
const LAST_REBOOT_MS = Date.parse('2026-10-17T12:00:00.000Z');

const baseDevice = {
  id: 4242,
  uid: 'dev-1',
  siteUid: 'site-a',
  siteName: 'Acme HQ',
  hostname: 'ACME-DC01',
  deviceClass: 'device',
  deviceType: { category: 'Server', type: 'Windows Server' },
  operatingSystem: 'Microsoft Windows Server 2019 Standard',
  online: true,
  suspended: false,
  deleted: false,
  lastSeen: LAST_SEEN_MS,
  lastReboot: LAST_REBOOT_MS,
  lastAuditDate: Date.parse('2026-10-18T00:00:00.000Z'),
  lastLoggedInUser: 'ACME\\jdoe',
  intIpAddress: '10.0.0.5',
  extIpAddress: '203.0.113.9',
  displayVersion: '4.4.2300',
  rebootRequired: true,
  warrantyDate: '2028-01-01',
  webRemoteUrl: 'https://merlot.centrastage.net/csm/remote/dev-1',
  portalUrl: 'https://merlot.centrastage.net/csm/device/dev-1',
  antivirus: { antivirusProduct: 'Windows Defender', antivirusStatus: 'RunningAndUpToDate' },
  patchManagement: { patchStatus: 'ApprovedPending', patchesApprovedPending: 7, patchesNotApproved: 2, patchesInstalled: 90 },
  udf: { udf1: 'rack 4' },
};

const snapshotOf = (overrides: Record<string, unknown> = {}) =>
  mapDattoDeviceToSnapshot({ ...baseDevice, ...overrides } as any, { integrationId: 'int-1', siteUid: 'site-a', now: NOW });

describe('mapDattoDeviceAssetType', () => {
  it.each([
    [{ deviceClass: 'device', deviceType: { category: 'Server' } }, 'server'],
    [{ deviceClass: 'device', deviceType: { category: 'Desktop' } }, 'workstation'],
    [{ deviceClass: 'device', deviceType: { category: 'Laptop' } }, 'workstation'],
    [{ deviceClass: 'device', deviceType: { category: 'Workstation' } }, 'workstation'],
    [{ deviceClass: 'printer', deviceType: { category: 'Printer' } }, 'network_device'],
    [{ deviceClass: 'rmmnetworkdevice', deviceType: { category: 'Network Device' } }, 'network_device'],
    [{ deviceClass: 'rmmnetdevice' }, 'network_device'],
    [{ deviceClass: 'esxihost', deviceType: { category: 'ESXi Host' } }, 'server'],
    [{ deviceClass: 'device', deviceType: { category: 'Mobile' } }, 'mobile_device'],
    [{ deviceClass: 'device', deviceType: { category: 'Something Else' } }, 'unknown'],
    [{ deviceClass: 'unknown' }, 'unknown'],
    [{}, 'unknown'],
  ])('%j -> %s', (device, expected) => {
    expect(mapDattoDeviceAssetType(device as any)).toBe(expected);
  });
});

describe('dattoTimestampToIso', () => {
  it('handles epoch ms, numeric strings, ISO strings and absent values', () => {
    expect(dattoTimestampToIso(1760875200000)).toBe('2025-10-19T12:00:00.000Z');
    expect(dattoTimestampToIso('1760875200000')).toBe('2025-10-19T12:00:00.000Z');
    expect(dattoTimestampToIso('2025-10-19T12:00:00Z')).toBe('2025-10-19T12:00:00.000Z');
    expect(dattoTimestampToIso(null)).toBeNull();
    expect(dattoTimestampToIso(undefined)).toBeNull();
    expect(dattoTimestampToIso('')).toBeNull();
    expect(dattoTimestampToIso('not a date')).toBeNull();
  });
});

describe('extractDattoOsFields', () => {
  it('derives the OS family', () => {
    expect(extractDattoOsFields('Microsoft Windows 11 Pro')).toEqual({ osType: 'Windows', osVersion: '11 Pro' });
    expect(extractDattoOsFields('Darwin 23.4.0')).toEqual({ osType: 'macOS', osVersion: '23.4.0' });
    expect(extractDattoOsFields('Ubuntu 22.04.4 LTS')).toEqual({ osType: 'Linux', osVersion: 'Ubuntu 22.04.4 LTS' });
    expect(extractDattoOsFields('')).toEqual({ osType: null, osVersion: null });
  });
});

describe('mapDattoDeviceToSnapshot', () => {
  it('maps an online server to an active snapshot with extension fields', () => {
    const snapshot = snapshotOf();
    expect(snapshot).toMatchObject({
      provider: 'datto',
      integrationId: 'int-1',
      externalDeviceId: 'dev-1',
      externalScopeId: 'site-a',
      lifecycleState: 'active',
      assetType: 'server',
      displayName: 'ACME-DC01',
      agentStatus: 'online',
      status: 'active',
      lastSeenAt: new Date(LAST_SEEN_MS).toISOString(),
    });
    expect(snapshot.extension).toMatchObject({
      osType: 'Windows',
      osVersion: 'Server 2019 Standard',
      agentVersion: '4.4.2300',
      currentUser: 'ACME\\jdoe',
      lanIp: '10.0.0.5',
      wanIp: '203.0.113.9',
      antivirusStatus: 'running',
      antivirusProduct: 'Windows Defender',
      lastRebootAt: new Date(LAST_REBOOT_MS).toISOString(),
      uptimeSeconds: 2 * 24 * 3600,
      pendingPatches: 7,
      pendingOsPatches: 7,
    });
    expect(snapshot.extension?.systemInfo).toMatchObject({
      rebootRequired: true,
      warrantyDate: '2028-01-01',
      webRemoteUrl: baseDevice.webRemoteUrl,
      portalUrl: baseDevice.portalUrl,
      datto_device_id: 4242,
      datto_site_uid: 'site-a',
      udf: { udf1: 'rack 4' },
      patchStatus: 'ApprovedPending',
      patchesNotApproved: 2,
      patchesInstalled: 90,
      lastAuditDate: new Date(baseDevice.lastAuditDate).toISOString(),
    });
    expect(snapshot.metadata).toMatchObject({
      datto_device_id: 4242,
      lastAuditDate: new Date(baseDevice.lastAuditDate).toISOString(),
    });
  });

  it('maps an offline device to offline lifecycle and agent status', () => {
    const snapshot = snapshotOf({ online: false });
    expect(snapshot.lifecycleState).toBe('offline');
    expect(snapshot.agentStatus).toBe('offline');
    expect(snapshot.status).toBe('inactive');
  });

  it('treats suspended as offline lifecycle even when the agent is online', () => {
    const snapshot = snapshotOf({ suspended: true, online: true });
    expect(snapshot.lifecycleState).toBe('offline');
    expect(snapshot.agentStatus).toBe('online');
  });

  it('tombstones a deleted device', () => {
    expect(snapshotOf({ deleted: true }).lifecycleState).toBe('tombstoned');
  });

  it('accepts epoch-ms strings and ISO timestamps', () => {
    const snapshot = snapshotOf({
      lastSeen: String(LAST_SEEN_MS),
      lastReboot: new Date(LAST_REBOOT_MS).toISOString(),
    });
    expect(snapshot.lastSeenAt).toBe(new Date(LAST_SEEN_MS).toISOString());
    expect(snapshot.extension?.lastRebootAt).toBe(new Date(LAST_REBOOT_MS).toISOString());
  });

  it('leaves uptime null when lastReboot is absent or in the future', () => {
    expect(snapshotOf({ lastReboot: null }).extension?.uptimeSeconds).toBeNull();
    expect(snapshotOf({ lastReboot: NOW.getTime() + 60_000 }).extension?.uptimeSeconds).toBeNull();
  });

  it('copes with a bare device record', () => {
    const snapshot = mapDattoDeviceToSnapshot({ uid: 'bare' } as any, { integrationId: 'int-1', siteUid: 'site-a', now: NOW });
    expect(snapshot.displayName).toBe('bare');
    expect(snapshot.assetType).toBe('unknown');
    expect(snapshot.agentStatus).toBe('offline');
    expect(snapshot.lastSeenAt).toBeNull();
    expect(snapshot.extension?.pendingPatches).toBeNull();
  });

  it('omits hardware fields from the extension when no audit ran', () => {
    const ext = snapshotOf().extension as Record<string, unknown>;
    for (const key of ['manufacturer', 'model', 'cpuModel', 'cpuCores', 'ramGb', 'diskUsage']) {
      expect(key in ext).toBe(false);
    }
  });
});

describe('antivirus status normalization', () => {
  it.each([
    ['RunningAndUpToDate', 'running'],
    ['RunningAndNotUpToDate', 'at_risk'],
    ['NotRunning', 'at_risk'],
    ['NotDetected', 'unknown'],
    ['SomethingNew', 'unknown'],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%j -> %j', (raw, expected) => {
    expect(normalizeDattoAntivirusStatus(raw as any)).toBe(expected);
  });

  it('writes the UI vocabulary to the extension and keeps the Datto enum in systemInfo', () => {
    const snapshot = snapshotOf({ antivirus: { antivirusProduct: 'Sophos', antivirusStatus: 'NotRunning' } });
    expect(snapshot.extension?.antivirusStatus).toBe('at_risk');
    expect(snapshot.extension?.systemInfo).toMatchObject({ antivirusStatusRaw: 'NotRunning' });
  });

  it('leaves both null when Datto reports no antivirus block', () => {
    const snapshot = snapshotOf({ antivirus: undefined });
    expect(snapshot.extension?.antivirusStatus).toBeNull();
    expect(snapshot.extension?.systemInfo).toMatchObject({ antivirusStatusRaw: null });
  });
});

describe('snapshot location and agent status', () => {
  it('sends the device siteName as location so ingestion does not blank it', () => {
    expect(snapshotOf().location).toBe('Acme HQ');
  });

  it('falls back to the mapped site name, then null', () => {
    const device = { ...baseDevice, siteName: undefined } as any;
    expect(mapDattoDeviceToSnapshot(device, { integrationId: 'i', siteUid: 's', siteName: 'Mapped Name', now: NOW }).location).toBe('Mapped Name');
    expect(mapDattoDeviceToSnapshot(device, { integrationId: 'i', siteUid: 's', now: NOW }).location).toBeNull();
  });

  it('reports a deleted device as offline', () => {
    expect(dattoAgentStatusFor({ online: true, deleted: true })).toBe('offline');
    expect(dattoAgentStatusFor({ online: true, deleted: false })).toBe('online');
    expect(dattoAgentStatusFor({})).toBe('offline');
  });
});
