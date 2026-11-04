/**
 * Datto RMM device -> normalized snapshot mappers.
 *
 * Pure functions: no I/O, no clock reads except through the `now` argument, so
 * the sync engine and the tests drive them with fixed inputs. Datto omits
 * fields freely and the live API sends epoch milliseconds although the spec
 * says string, so every read here tolerates null/absent and either timestamp
 * shape.
 */
import type { RmmStorageInfo } from '@alga-psa/types';
import type {
  NormalizedRmmDeviceExtensionSnapshot,
  NormalizedRmmDeviceLifecycleState,
  NormalizedRmmDeviceType,
  NormalizedRmmExternalDeviceSnapshot,
} from '@alga-psa/shared/rmm/contracts';

import type {
  DattoDevice,
  DattoDeviceAudit,
  DattoEsxiHostAudit,
  DattoPhysicalMemory,
  DattoPrinterAudit,
  DattoTimestamp,
} from './types';
import { DATTO_RMM_PROVIDER } from './shared';

const BYTES_PER_GB = 1024 ** 3;

/** Hardware identity and capacity read from a device audit. */
export interface DattoHardware {
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  cpuModel: string | null;
  cpuCores: number | null;
  ramGb: number | null;
  diskUsage: RmmStorageInfo[] | null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Epoch milliseconds (number or numeric string) or an ISO string, as epoch ms.
 * Null for absent or unparseable input.
 */
export function dattoTimestampToMs(value: DattoTimestamp | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/** Datto timestamp (number, numeric string, ISO string, null) as an ISO string. */
export function dattoTimestampToIso(value: DattoTimestamp | undefined): string | null {
  const ms = dattoTimestampToMs(value);
  if (ms === null) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Asset type from `deviceClass` first (printers, ESXi hosts and network
 * devices are classes, not categories), then `deviceType.category`/`type`.
 */
export function mapDattoDeviceAssetType(
  device: Pick<DattoDevice, 'deviceClass' | 'deviceType'>
): NormalizedRmmDeviceType {
  const deviceClass = String(device.deviceClass ?? '').trim().toLowerCase();
  if (deviceClass === 'printer') return 'network_device';
  if (deviceClass === 'esxihost') return 'server';
  // The spec spells it 'rmmnetworkdevice'; accept the short form too.
  if (deviceClass.startsWith('rmmnet') || deviceClass === 'networkdevice') return 'network_device';

  const category = String(device.deviceType?.category ?? '').trim().toLowerCase();
  const type = String(device.deviceType?.type ?? '').trim().toLowerCase();
  const label = `${category} ${type}`;

  if (category.includes('server') || type.includes('server')) return 'server';
  if (/\b(desktop|laptop|workstation|notebook)\b/.test(label)) return 'workstation';
  if (/\b(esxi|hypervisor)\b/.test(label)) return 'server';
  if (/\b(printer|network|switch|router|firewall|access point)\b/.test(label)) return 'network_device';
  if (/\b(mobile|phone|tablet)\b/.test(label)) return 'mobile_device';
  return 'unknown';
}

/**
 * Splits Datto's free-text `operatingSystem` ("Microsoft Windows 11 Pro",
 * "Darwin 23.4", "Ubuntu 22.04.4 LTS") into a family and a remainder.
 */
export function extractDattoOsFields(operatingSystem: string | null | undefined): {
  osType: string | null;
  osVersion: string | null;
} {
  const raw = cleanString(operatingSystem);
  if (!raw) return { osType: null, osVersion: null };

  const lower = raw.toLowerCase();
  const strip = (pattern: RegExp) => cleanString(raw.replace(pattern, ''));

  if (lower.includes('windows')) {
    return { osType: 'Windows', osVersion: strip(/^\s*(microsoft\s+)?windows\s*/i) };
  }
  if (/\b(mac\s?os|os\s?x|darwin)\b/i.test(raw)) {
    return { osType: 'macOS', osVersion: strip(/^\s*(apple\s+)?(mac\s?os(\s?x)?|os\s?x|darwin)\s*/i) };
  }
  if (/\b(linux|ubuntu|debian|centos|red\s?hat|rhel|fedora|suse|rocky|alma)/i.test(raw)) {
    const isLinuxLabel = /^\s*linux\b/i.test(raw);
    return { osType: 'Linux', osVersion: isLinuxLabel ? strip(/^\s*linux\s*/i) : raw };
  }

  const parts = raw.split(/\s+/);
  return {
    osType: parts[0] || raw,
    osVersion: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

function toCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function lifecycleFor(device: Pick<DattoDevice, 'deleted' | 'suspended' | 'online'>): NormalizedRmmDeviceLifecycleState {
  if (device.deleted === true) return 'tombstoned';
  if (device.suspended === true) return 'offline';
  return device.online === true ? 'active' : 'offline';
}

/** The agent_status ingestion writes for a device; a deleted device is always offline. */
export function dattoAgentStatusFor(device: Pick<DattoDevice, 'deleted' | 'online'>): 'online' | 'offline' {
  return device.deleted !== true && device.online === true ? 'online' : 'offline';
}

/**
 * Datto's antivirus enum folded into the vocabulary the asset UI and health
 * checks read ('running' is healthy, 'at_risk' is not, as NinjaOne emits). The
 * raw value is kept in systemInfo.antivirusStatusRaw.
 */
export function normalizeDattoAntivirusStatus(raw: string | null | undefined): string | null {
  const value = cleanString(raw);
  if (!value) return null;
  switch (value.toLowerCase()) {
    case 'runninganduptodate':
      return 'running';
    case 'runningandnotuptodate':
    case 'notrunning':
      return 'at_risk';
    // No product to report on: the health check flags a missing product on its own.
    case 'notdetected':
    default:
      return 'unknown';
  }
}

/**
 * Maps one Datto device (plus, optionally, its audit-derived hardware) to the
 * snapshot the shared ingestion service writes.
 *
 * Hardware fields are left out of the extension entirely when no audit ran, so
 * the ingestion patch does not blank values an earlier audit already stored.
 */
export function mapDattoDeviceToSnapshot(
  device: DattoDevice,
  options: {
    integrationId: string;
    siteUid?: string | null;
    /** The mapped site's name, for devices whose own siteName is absent. */
    siteName?: string | null;
    hardware?: DattoHardware | null;
    now?: Date;
  }
): NormalizedRmmExternalDeviceSnapshot {
  const now = options.now ?? new Date();
  const siteUid = options.siteUid ?? device.siteUid ?? '';
  const online = device.online === true;
  const siteName = cleanString(device.siteName) ?? cleanString(options.siteName);
  const lifecycleState = lifecycleFor(device);

  const lastSeenAt = dattoTimestampToIso(device.lastSeen);
  const lastRebootAt = dattoTimestampToIso(device.lastReboot);
  const lastAuditDate = dattoTimestampToIso(device.lastAuditDate);

  let uptimeSeconds: number | null = null;
  const rebootMs = dattoTimestampToMs(device.lastReboot);
  if (rebootMs !== null && rebootMs <= now.getTime()) {
    uptimeSeconds = Math.floor((now.getTime() - rebootMs) / 1000);
  }

  const { osType, osVersion } = extractDattoOsFields(device.operatingSystem);
  const patch = device.patchManagement ?? null;
  const pendingPatches = toCount(patch?.patchesApprovedPending);

  const extension: NormalizedRmmDeviceExtensionSnapshot = {
    osType,
    osVersion,
    agentVersion: cleanString(device.displayVersion),
    currentUser: cleanString(device.lastLoggedInUser),
    uptimeSeconds,
    lanIp: cleanString(device.intIpAddress),
    wanIp: cleanString(device.extIpAddress),
    antivirusStatus: normalizeDattoAntivirusStatus(device.antivirus?.antivirusStatus),
    antivirusProduct: cleanString(device.antivirus?.antivirusProduct),
    lastRebootAt,
    // Datto's patch counts come from Windows Update policy, so the approved-
    // pending total is both the overall and the OS figure.
    pendingPatches,
    pendingOsPatches: pendingPatches,
    systemInfo: {
      rebootRequired: device.rebootRequired ?? null,
      warrantyDate: cleanString(device.warrantyDate),
      webRemoteUrl: cleanString(device.webRemoteUrl),
      portalUrl: cleanString(device.portalUrl),
      datto_device_id: device.id ?? null,
      datto_site_uid: siteUid || null,
      udf: device.udf ?? null,
      antivirusStatusRaw: cleanString(device.antivirus?.antivirusStatus),
      patchStatus: cleanString(patch?.patchStatus),
      patchesApprovedPending: toCount(patch?.patchesApprovedPending),
      patchesNotApproved: toCount(patch?.patchesNotApproved),
      patchesInstalled: toCount(patch?.patchesInstalled),
      lastAuditDate,
    },
  };

  const hardware = options.hardware ?? null;
  if (hardware) {
    extension.manufacturer = hardware.manufacturer;
    extension.model = hardware.model;
    extension.cpuModel = hardware.cpuModel;
    extension.cpuCores = hardware.cpuCores;
    extension.ramGb = hardware.ramGb;
    extension.diskUsage = hardware.diskUsage;
  }

  const metadata: Record<string, unknown> = {
    datto_device_id: device.id ?? null,
    datto_site_uid: siteUid || null,
    hostname: cleanString(device.hostname),
    deviceClass: cleanString(device.deviceClass),
    siteName,
    // Compared against the next sync's value to decide whether the audit
    // endpoint needs another call.
    lastAuditDate,
  };

  return {
    provider: DATTO_RMM_PROVIDER,
    integrationId: options.integrationId,
    externalDeviceId: device.uid,
    externalScopeId: siteUid,
    lifecycleState,
    assetType: mapDattoDeviceAssetType(device),
    displayName: cleanString(device.hostname) ?? cleanString(device.description) ?? device.uid,
    serialNumber: hardware?.serialNumber ?? null,
    status: online && lifecycleState === 'active' ? 'active' : 'inactive',
    assetTag: `${DATTO_RMM_PROVIDER}:${device.uid}`,
    agentStatus: dattoAgentStatusFor(device),
    // Ingestion writes location on every update (blank when absent), so the
    // site name is sent each time, the same value Tactical gives a new asset.
    location: siteName,
    lastSeenAt,
    extension,
    metadata,
  };
}

function sumMemoryGb(modules: DattoPhysicalMemory[] | null | undefined, fallbackBytes?: number | null): number | null {
  const bytes = (modules ?? []).reduce(
    (total, module) => total + (typeof module?.size === 'number' && Number.isFinite(module.size) && module.size > 0 ? module.size : 0),
    0
  );
  const effective = bytes > 0 ? bytes : typeof fallbackBytes === 'number' && fallbackBytes > 0 ? fallbackBytes : 0;
  // ram_gb is an integer column; whole GB only.
  return effective > 0 ? Math.round(effective / BYTES_PER_GB) : null;
}

function mapLogicalDisks(disks: DattoDeviceAudit['logicalDisks']): RmmStorageInfo[] | null {
  const storage: RmmStorageInfo[] = [];
  (disks ?? []).forEach((disk, index) => {
    const size = disk?.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return;
    const entry: RmmStorageInfo = {
      name: cleanString(disk.diskIdentifier) ?? cleanString(disk.description) ?? `Disk ${index + 1}`,
      total_gb: roundTo(size / BYTES_PER_GB, 2),
    };
    const free = disk.freespace;
    if (typeof free === 'number' && Number.isFinite(free) && free >= 0) {
      const clampedFree = Math.min(free, size);
      entry.free_gb = roundTo(clampedFree / BYTES_PER_GB, 2);
      entry.utilization_percent = roundTo(((size - clampedFree) / size) * 100, 1);
    }
    storage.push(entry);
  });
  return storage.length ? storage : null;
}

/** Workstation/server audit (`/v2/audit/device/{uid}`). */
export function mapDattoAuditToHardware(audit: DattoDeviceAudit | null | undefined): DattoHardware {
  const systemInfo = audit?.systemInfo ?? null;
  const processors = audit?.processors ?? [];
  const totalCores = toCount(systemInfo?.totalCpuCores);
  return {
    // The spec's BaseBoard carries no serial, but the live API has been seen to
    // send one; read it loosely as the fallback.
    serialNumber:
      cleanString(audit?.bios?.serialNumber)
      ?? cleanString((audit?.baseBoard as { serialNumber?: unknown } | null | undefined)?.serialNumber),
    manufacturer: cleanString(systemInfo?.manufacturer),
    model: cleanString(systemInfo?.model),
    cpuModel: cleanString(processors[0]?.name),
    // The audit reports total cores on systemInfo; the processor list has no
    // core count, so a missing total stays null rather than guessing.
    cpuCores: totalCores,
    ramGb: sumMemoryGb(audit?.physicalMemory, systemInfo?.totalPhysicalMemory),
    diskUsage: mapLogicalDisks(audit?.logicalDisks),
  };
}

/** Printer audit (`/v2/audit/printer/{uid}`): identity only, best-effort. */
export function mapDattoPrinterAuditToHardware(audit: DattoPrinterAudit | null | undefined): DattoHardware {
  return {
    serialNumber: cleanString((audit?.snmpInfo as { snmpSerial?: unknown } | null | undefined)?.snmpSerial),
    manufacturer: cleanString(audit?.systemInfo?.manufacturer),
    model: cleanString(audit?.systemInfo?.model),
    cpuModel: null,
    cpuCores: null,
    ramGb: null,
    diskUsage: null,
  };
}

/** ESXi host audit (`/v2/audit/esxihost/{uid}`): best-effort, loose. */
export function mapDattoEsxiAuditToHardware(audit: DattoEsxiHostAudit | null | undefined): DattoHardware {
  const processors = audit?.processors ?? [];
  const cores = processors.reduce(
    (total, processor) => total + (typeof processor?.numberOfCores === 'number' ? processor.numberOfCores : 0),
    0
  );
  return {
    serialNumber: cleanString(audit?.systemInfo?.serviceTag),
    manufacturer: cleanString(audit?.systemInfo?.manufacturer),
    model: cleanString(audit?.systemInfo?.model),
    cpuModel: cleanString(processors[0]?.name),
    cpuCores: cores > 0 ? cores : null,
    ramGb: sumMemoryGb(audit?.physicalMemory),
    diskUsage: null,
  };
}
