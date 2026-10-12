/**
 * UniFi device → normalized RMM snapshot mapping.
 *
 * ASSUMPTIONS (unverified against a live key, plan §7.1): the model-prefix
 * regexes and `features` names below, and the state strings. Every one lives in
 * this file so the API spike can correct them in one place.
 */

import type {
  NormalizedRmmExternalDeviceSnapshot,
  NormalizedRmmNetworkDeviceType,
} from '@alga-psa/shared/rmm/contracts';
import type { RmmAlertSeverity } from '../../../../interfaces/rmm.interfaces';
import type { UniFiDevice } from '../unifiApiClient';

const PROVIDER = 'unifi' as const;

export type UniFiDeviceKind = 'gateway' | 'switch' | 'access_point';
export type UniFiStateClass = 'online' | 'offline' | 'transitional' | 'not_adopted' | 'unknown';

const GATEWAY_MODEL = /^(UDM|UDR|UDW|UXG|UCG|USG|UGW|EFG)/i;
const FIREWALL_MODEL = /^(UXG|UDM-?(PRO|SE)|UDW|EFG|UCG-?(FIBER|MAX|ULTRA)?)/i;
const SWITCH_MODEL = /^(USW|US-?\d|USL|ECS)/i;
const AP_MODEL = /^(U7|U6|U5|UAP|UWB|E7|UK-ULTRA|UAL|UBB)/i;

const OFFLINE_STATES = new Set(['OFFLINE', 'DISCONNECTED', 'CONNECTION_INTERRUPTED', 'ISOLATED']);
const TRANSITIONAL_STATES = new Set(['UPDATING', 'GETTING_READY', 'ADOPTING', 'PROVISIONING', 'RESTARTING']);

/** Lowercase, colon-separated MAC, or null if the input is not 12 hex digits. */
export function normalizeMac(input: string | null | undefined): string | null {
  if (!input) return null;
  const hex = input.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(':');
}

export function classifyUniFiState(state: string | null | undefined): UniFiStateClass {
  const value = (state ?? '').trim().toUpperCase();
  if (!value) return 'unknown';
  if (value === 'ONLINE') return 'online';
  if (value === 'PENDING_ADOPTION') return 'not_adopted';
  if (OFFLINE_STATES.has(value)) return 'offline';
  if (TRANSITIONAL_STATES.has(value)) return 'transitional';
  return 'unknown';
}

/** Returns null for models that are not gateways/switches/APs (e.g. protect/access hardware). */
export function deriveDeviceKind(device: Pick<UniFiDevice, 'model' | 'features'>): UniFiDeviceKind | null {
  const features = device.features.map((f) => f.toLowerCase());
  const model = (device.model ?? '').trim();
  if (GATEWAY_MODEL.test(model)) return 'gateway';
  if (features.includes('switching') || SWITCH_MODEL.test(model)) return 'switch';
  if (features.includes('accesspoint') || AP_MODEL.test(model)) return 'access_point';
  return null;
}

export function mapDeviceKindToNetworkType(
  kind: UniFiDeviceKind,
  model: string | null | undefined
): NormalizedRmmNetworkDeviceType {
  switch (kind) {
    case 'gateway':
      return FIREWALL_MODEL.test((model ?? '').trim()) ? 'firewall' : 'router';
    case 'switch':
      return 'switch';
    case 'access_point':
      return 'access_point';
  }
}

/** Gateway critical, switch major, AP moderate: how much of a site goes dark with it. */
export function severityForKind(kind: UniFiDeviceKind): RmmAlertSeverity {
  switch (kind) {
    case 'gateway':
      return 'critical';
    case 'switch':
      return 'major';
    case 'access_point':
      return 'moderate';
  }
}

/** Stable per-device external id: the Network device id, else the normalized MAC. */
export function resolveExternalDeviceId(device: Pick<UniFiDevice, 'id' | 'macAddress'>): string | null {
  return device.id ?? normalizeMac(device.macAddress);
}

export function mapUniFiDeviceToSnapshot(args: {
  integrationId: string;
  device: UniFiDevice;
  scopeKey: string;
  siteName?: string | null;
}): NormalizedRmmExternalDeviceSnapshot | null {
  const { device } = args;
  const kind = deriveDeviceKind(device);
  const externalDeviceId = resolveExternalDeviceId(device);
  if (!kind || !externalDeviceId) return null;

  const stateClass = classifyUniFiState(device.state);
  if (stateClass === 'not_adopted') return null;
  const isOffline = stateClass === 'offline';
  const mac = normalizeMac(device.macAddress);
  const networkType = mapDeviceKindToNetworkType(kind, device.model);

  return {
    provider: PROVIDER,
    integrationId: args.integrationId,
    externalDeviceId,
    externalScopeId: args.scopeKey,
    lifecycleState: isOffline ? 'offline' : 'active',
    assetType: 'network_device',
    displayName: device.name || device.model || externalDeviceId,
    serialNumber: device.serialNumber ?? null,
    status: isOffline ? 'inactive' : 'active',
    location: args.siteName ?? null,
    assetTag: `unifi:${externalDeviceId}`,
    agentStatus: isOffline ? 'offline' : stateClass === 'online' ? 'online' : null,
    lastSeenAt: device.stateChangedAt && !isOffline ? device.stateChangedAt : null,
    extension: {
      lanIp: device.ipAddress ?? null,
      networkDevice: {
        deviceType: networkType,
        managementIp: device.ipAddress ?? null,
        firmwareVersion: device.firmwareVersion ?? null,
      },
      systemInfo: {
        model: device.model ?? null,
        macAddress: mac,
        state: device.state ?? null,
        firmwareUpdatable: device.firmwareUpdatable,
        uplinkDeviceId: device.uplinkDeviceId,
        kind,
      },
    },
    metadata: {
      kind,
      macAddress: mac,
      model: device.model ?? null,
      uplinkDeviceId: device.uplinkDeviceId,
    },
  };
}
