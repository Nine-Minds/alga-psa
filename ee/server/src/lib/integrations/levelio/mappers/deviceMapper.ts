import type { RmmStorageInfo } from '@alga-psa/types';
import type { NormalizedRmmExternalDeviceSnapshot } from '@alga-psa/shared/rmm/contracts';
import type { RmmAlertSeverity } from '../../../../interfaces/rmm.interfaces';
import type { LevelIoDevice, LevelIoGroup, LevelIoNetworkInterface } from '../levelApiClient';

const PROVIDER = 'levelio' as const;
const BYTES_PER_GB = 1024 ** 3;
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mapLevelIoSeverity(input: unknown): RmmAlertSeverity {
  switch (String(input || '').toLowerCase()) {
    case 'emergency':
      return 'critical';
    case 'critical':
      return 'major';
    case 'warning':
      return 'moderate';
    case 'information':
      return 'minor';
    default:
      return 'none';
  }
}

export function buildGroupParentMap(groups: LevelIoGroup[]): Map<string, string | null> {
  return new Map(groups.map((group) => [group.id, group.parent_id ?? null]));
}

/**
 * Walks from the device's group up the hierarchy and returns the first
 * (i.e. deepest) group that has a client mapping. Deterministic when both a
 * parent and a child group are mapped.
 */
export function resolveDeepestMappedGroup(
  groupId: string | null | undefined,
  parentByGroupId: Map<string, string | null>,
  mappedGroupIds: Set<string>
): string | null {
  let current = groupId ?? null;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (mappedGroupIds.has(current)) {
      return current;
    }
    visited.add(current);
    current = parentByGroupId.get(current) ?? null;
  }
  return null;
}

export function buildGroupPath(groupId: string, groupsById: Map<string, LevelIoGroup>): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let current: string | null = groupId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const group = groupsById.get(current);
    if (!group) break;
    names.unshift(group.name);
    current = group.parent_id ?? null;
  }
  return names.join(' / ');
}

export function extractLanIp(interfaces?: LevelIoNetworkInterface[] | null): string | null {
  for (const iface of interfaces ?? []) {
    if ((iface.description || '').toLowerCase().includes('virtual')) continue;
    for (const ip of iface.ip_addresses ?? []) {
      if (PRIVATE_IPV4.test(ip)) {
        return ip;
      }
    }
  }
  return null;
}

export function mapLevelIoDiskUsage(device: LevelIoDevice): RmmStorageInfo[] {
  return (device.disk_partitions ?? [])
    .filter((partition) => typeof partition.size === 'number' && partition.size > 0)
    .map((partition) => {
      const totalGb = roundTo2((partition.size as number) / BYTES_PER_GB);
      const freeGb = typeof partition.free_space === 'number' ? roundTo2(partition.free_space / BYTES_PER_GB) : 0;
      const utilization = totalGb > 0 ? roundTo2(((totalGb - freeGb) / totalGb) * 100) : 0;
      return {
        name: partition.mount_point || partition.label || 'disk',
        total_gb: totalGb,
        free_gb: freeGb,
        utilization_percent: utilization,
      };
    });
}

export function mapLevelIoDeviceToSnapshot(args: {
  integrationId: string;
  device: LevelIoDevice;
  scopeId: string;
  pendingOsPatches?: number | null;
}): NormalizedRmmExternalDeviceSnapshot {
  const { device } = args;
  const isOnline = device.online === true;
  const uptimeSeconds = isOnline && device.last_reboot_time
    ? Math.max(0, Math.floor((Date.now() - new Date(device.last_reboot_time).getTime()) / 1000))
    : null;
  const cpu = device.cpus?.[0];
  const location = [device.city, device.country].filter(Boolean).join(', ') || null;

  return {
    provider: PROVIDER,
    integrationId: args.integrationId,
    externalDeviceId: device.id,
    externalScopeId: args.scopeId,
    lifecycleState: isOnline ? 'active' : 'offline',
    assetType: device.role === 'server' || device.role === 'domain_controller' ? 'server' : 'workstation',
    displayName: device.nickname || device.hostname || device.id,
    serialNumber: device.serial_number ?? null,
    status: isOnline ? 'active' : 'inactive',
    location,
    assetTag: `levelio:${device.id}`,
    agentStatus: isOnline ? 'online' : 'offline',
    lastSeenAt: device.last_seen_at ?? null,
    extension: {
      osType: device.platform ?? null,
      osVersion:
        device.operating_system?.minor_version ??
        device.operating_system?.major_version ??
        device.operating_system?.full_operating_system ??
        null,
      currentUser: device.last_logged_in_user ?? null,
      uptimeSeconds,
      lanIp: extractLanIp(device.network_interfaces),
      wanIp: null,
      antivirusStatus: device.security?.antivirus_status ?? null,
      antivirusProduct: device.security?.antivirus_provider ?? null,
      lastRebootAt: device.last_reboot_time ?? null,
      pendingOsPatches: args.pendingOsPatches ?? null,
      cpuModel: cpu?.model ?? null,
      cpuCores: device.cpu_cores ?? cpu?.cores ?? null,
      // ram_gb is an integer column; round to whole GB (matches NinjaOne's getRamGb).
      // roundTo2 here produced decimals like 15.74 that Postgres rejects for type integer.
      ramGb: typeof device.total_memory === 'number' ? Math.round(device.total_memory / BYTES_PER_GB) : null,
      diskUsage: mapLevelIoDiskUsage(device),
      systemInfo: {
        manufacturer: device.manufacturer ?? null,
        model: device.model ?? null,
        fullOperatingSystem: device.operating_system?.full_operating_system ?? null,
        osEndOfLife: device.operating_system?.end_of_life ?? device.security?.os_end_of_life ?? false,
        securityScore: device.security?.score ?? device.security_score ?? null,
        securityRisk: device.security?.risk ?? null,
        patchSecurityRisk: device.security?.patch_security_risk ?? null,
        maintenanceMode: Boolean(device.maintenance_mode),
        flag: device.flag ?? null,
        tags: device.tags ?? [],
        groupId: device.group_id ?? null,
      },
    },
    metadata: {
      hostname: device.hostname,
      groupId: device.group_id ?? null,
      tags: device.tags ?? [],
    },
  };
}
