import type { RmmAgentStatus, RmmProvider } from '@alga-psa/types';

export type NormalizedRmmScopeKind = 'organization' | 'site' | 'group' | 'custom';

export interface NormalizedRmmExternalScopeSnapshot {
  provider: RmmProvider;
  externalScopeId: string;
  externalScopeName: string;
  parentExternalScopeId?: string | null;
  kind: NormalizedRmmScopeKind;
  metadata?: Record<string, unknown>;
}

export type NormalizedRmmDeviceType = 'workstation' | 'server' | 'network_device' | 'mobile_device' | 'unknown';
export type NormalizedRmmDeviceLifecycleState = 'active' | 'offline' | 'deleted' | 'tombstoned';

export interface NormalizedRmmDeviceExtensionSnapshot {
  osType?: string | null;
  osVersion?: string | null;
  agentVersion?: string | null;
  currentUser?: string | null;
  uptimeSeconds?: number | null;
  lanIp?: string | null;
  wanIp?: string | null;
  antivirusStatus?: string | null;
  antivirusProduct?: string | null;
  lastRebootAt?: string | null;
  pendingPatches?: number | null;
  pendingOsPatches?: number | null;
  pendingSoftwarePatches?: number | null;
  failedPatches?: number | null;
  lastPatchScanAt?: string | null;
  systemInfo?: Record<string, unknown> | null;
}

export interface NormalizedRmmExternalDeviceSnapshot {
  provider: RmmProvider;
  integrationId: string;
  externalDeviceId: string;
  externalScopeId: string;
  lifecycleState: NormalizedRmmDeviceLifecycleState;
  assetType: NormalizedRmmDeviceType;
  displayName: string;
  serialNumber?: string | null;
  status?: string | null;
  location?: string | null;
  assetTag?: string | null;
  agentStatus?: RmmAgentStatus | null;
  lastSeenAt?: string | null;
  extension?: NormalizedRmmDeviceExtensionSnapshot;
  metadata?: Record<string, unknown>;
}

export interface NormalizedRmmIngestionResult {
  externalDeviceId: string;
  action: 'created' | 'updated' | 'marked_deleted' | 'skipped' | 'failed';
  assetId?: string;
  error?: string;
}
