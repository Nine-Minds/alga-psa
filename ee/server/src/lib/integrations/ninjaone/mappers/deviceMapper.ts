/**
 * NinjaOne Device Mapper
 *
 * Transforms NinjaOne device data into Alga PSA asset format.
 * Handles field mapping, type detection, and extension data population.
 */

import {
  NinjaOneDevice,
  NinjaOneDeviceDetail,
  NinjaOneNodeClass,
  NinjaOneVolume,
  NinjaOneProcessor,
  NinjaOneNetworkInterface,
  NinjaOneAntivirus,
  mapNodeClassToAssetType,
} from '../../../../interfaces/ninjaone.interfaces';
import {
  Asset,
  WorkstationAsset,
  ServerAsset,
  NetworkDeviceAsset,
  CreateAssetRequest,
  RmmProvider,
  RmmAgentStatus,
} from '../../../../../../../server/src/interfaces/asset.interfaces';

/**
 * Asset type mapping from NinjaOne node class
 */
export type AlgaAssetType = 'workstation' | 'server' | 'network_device' | 'mobile_device' | 'printer' | 'unknown';

/**
 * Determine Alga asset type from NinjaOne device node class
 */
export function determineAssetType(nodeClass: NinjaOneNodeClass): AlgaAssetType {
  switch (nodeClass) {
    case 'WINDOWS_WORKSTATION':
    case 'MAC':
    case 'LINUX_WORKSTATION':
      return 'workstation';
    case 'WINDOWS_SERVER':
    case 'LINUX_SERVER':
    case 'VMWARE_VM_HOST':
    case 'VMWARE_VM_GUEST':
    case 'HYPERV_VMM_HOST':
    case 'HYPERV_VMM_GUEST':
      return 'server';
    case 'NMS':
    case 'CLOUD_MONITOR_TARGET':
      return 'network_device';
    default:
      return 'unknown';
  }
}

/**
 * Map NinjaOne agent status to Alga status
 */
export function mapAgentStatus(offline: boolean): RmmAgentStatus {
  return offline ? 'offline' : 'online';
}

/**
 * Calculate total storage capacity from volumes
 */
export function calculateTotalStorage(volumes?: NinjaOneVolume[]): number {
  if (!volumes || volumes.length === 0) return 0;
  return volumes.reduce((total, vol) => {
    const capacityBytes = vol.capacity || 0;
    return total + Math.round(capacityBytes / (1024 * 1024 * 1024)); // Convert to GB
  }, 0);
}

/**
 * Get primary processor info
 */
export function getPrimaryProcessor(processors?: NinjaOneProcessor[]): {
  model: string;
  cores: number;
} {
  if (!processors || processors.length === 0) {
    return { model: 'Unknown', cores: 0 };
  }
  const primary = processors[0];
  return {
    model: primary.name || 'Unknown',
    cores: primary.cores || primary.logicalCores || 0,
  };
}

/**
 * Get RAM in GB from memory capacity
 */
export function getRamGb(memoryCapacityBytes?: number): number {
  if (!memoryCapacityBytes) return 0;
  return Math.round(memoryCapacityBytes / (1024 * 1024 * 1024));
}

/**
 * Get primary antivirus status
 */
export function getAntivirusInfo(antivirusProducts?: NinjaOneAntivirus[]): {
  status: string;
  product: string;
} {
  if (!antivirusProducts || antivirusProducts.length === 0) {
    return { status: 'unknown', product: '' };
  }
  const primary = antivirusProducts[0];

  // Map NinjaOne AV state to simplified status
  let status = 'unknown';
  if (primary.state === 'ON' && primary.definitionStatus === 'UP_TO_DATE') {
    status = 'protected';
  } else if (primary.state === 'OFF' || primary.definitionStatus === 'OUT_OF_DATE') {
    status = 'at_risk';
  }

  return {
    status,
    product: primary.name || '',
  };
}

/**
 * Extract OS type (simplified name)
 */
export function getOsType(osName?: string): string {
  if (!osName) return 'unknown';

  const lowerName = osName.toLowerCase();
  if (lowerName.includes('windows')) return 'Windows';
  if (lowerName.includes('mac') || lowerName.includes('darwin')) return 'macOS';
  if (lowerName.includes('linux') || lowerName.includes('ubuntu') || lowerName.includes('centos') || lowerName.includes('debian')) return 'Linux';

  return osName;
}

/**
 * Generate asset tag from device info
 */
export function generateAssetTag(device: NinjaOneDevice): string {
  // Use system serial number if available, otherwise generate from device ID
  if (device.system?.serialNumber) {
    return `NINJA-${device.system.serialNumber}`;
  }
  return `NINJA-${device.id}`;
}

/**
 * Map network interfaces to storage format
 */
export function mapNetworkInterfaces(interfaces?: NinjaOneNetworkInterface[]): unknown[] {
  if (!interfaces) return [];

  return interfaces.map(nic => ({
    name: nic.name,
    mac_address: nic.macAddress,
    ip_addresses: nic.ipAddresses || [],
    gateway: nic.gateway,
    dns_servers: nic.dns || [],
    dhcp_enabled: nic.dhcp,
    speed_mbps: nic.speed ? nic.speed / 1000000 : undefined,
    type: nic.type,
  }));
}

/**
 * Map volumes to disk usage format
 */
export function mapDiskUsage(volumes?: NinjaOneVolume[]): Array<{
  drive: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent_used: number;
}> {
  if (!volumes) return [];

  return volumes
    .filter(vol => vol.capacity && vol.capacity > 0)
    .map(vol => {
      const totalGb = Math.round((vol.capacity || 0) / (1024 * 1024 * 1024));
      const freeGb = Math.round((vol.freeSpace || 0) / (1024 * 1024 * 1024));
      const usedGb = totalGb - freeGb;
      const percentUsed = totalGb > 0 ? Math.round((usedGb / totalGb) * 100) : 0;

      return {
        drive: vol.name || vol.label || 'Unknown',
        total_gb: totalGb,
        used_gb: usedGb,
        free_gb: freeGb,
        percent_used: percentUsed,
      };
    });
}

/**
 * Map basic NinjaOne device to Alga asset fields
 */
export function mapDeviceToAssetBase(
  device: NinjaOneDevice,
  companyId: string,
  integrationId: string
): Partial<Asset> {
  const assetType = determineAssetType(device.nodeClass);

  return {
    asset_type: assetType,
    client_id: companyId,
    name: device.displayName || device.systemName || `Device-${device.id}`,
    asset_tag: generateAssetTag(device),
    serial_number: device.system?.serialNumber || device.system?.biosSerialNumber,
    status: device.approvalStatus === 'APPROVED' ? 'active' : 'pending',
    location: device.references?.location?.name,
    // RMM fields
    rmm_provider: 'ninjaone' as RmmProvider,
    rmm_device_id: String(device.id),
    rmm_organization_id: String(device.organizationId),
    agent_status: mapAgentStatus(device.offline),
    last_seen_at: device.lastContact,
    last_rmm_sync_at: new Date().toISOString(),
  };
}

/**
 * Map NinjaOne device detail to workstation extension data
 */
export function mapToWorkstationExtension(
  device: NinjaOneDeviceDetail
): Partial<WorkstationAsset> {
  const processor = getPrimaryProcessor(device.processors);
  const antivirus = getAntivirusInfo(device.antivirus);

  return {
    os_type: getOsType(device.os?.name),
    os_version: device.os?.version || '',
    cpu_model: processor.model,
    cpu_cores: processor.cores,
    ram_gb: getRamGb(device.system?.memory?.capacity),
    storage_type: 'mixed', // NinjaOne doesn't provide clear SSD/HDD distinction
    storage_capacity_gb: calculateTotalStorage(device.volumes),
    gpu_model: undefined, // Not typically available from NinjaOne
    last_login: device.lastLoggedInUser ? undefined : undefined, // Would need activity data
    installed_software: device.software || [],
    // RMM-specific fields
    agent_version: undefined, // Would need to fetch from agent info
    antivirus_status: antivirus.status,
    antivirus_product: antivirus.product,
    last_reboot_at: device.os?.lastBootTime,
    pending_patches: undefined, // Fetched separately via patch API
    failed_patches: undefined,
    last_patch_scan_at: undefined,
    system_info: {
      manufacturer: device.system?.manufacturer,
      model: device.system?.model,
      chassis_type: device.system?.chassisType,
      domain: device.system?.domain,
      dns_name: device.dnsName,
      netbios_name: device.netbiosName,
      public_ip: device.publicIP,
      timezone: device.os?.timezone?.name,
      locale: device.os?.locale,
    },
  };
}

/**
 * Map NinjaOne device detail to server extension data
 */
export function mapToServerExtension(
  device: NinjaOneDeviceDetail
): Partial<ServerAsset> {
  const processor = getPrimaryProcessor(device.processors);
  const antivirus = getAntivirusInfo(device.antivirus);
  const isVirtual = device.nodeClass.includes('VM_GUEST') || device.nodeClass.includes('VMM_GUEST');

  return {
    os_type: getOsType(device.os?.name),
    os_version: device.os?.version || '',
    cpu_model: processor.model,
    cpu_cores: processor.cores,
    ram_gb: getRamGb(device.system?.memory?.capacity),
    storage_config: device.volumes?.map(v => ({
      name: v.name || v.label,
      capacity_gb: Math.round((v.capacity || 0) / (1024 * 1024 * 1024)),
      free_gb: Math.round((v.freeSpace || 0) / (1024 * 1024 * 1024)),
      file_system: v.fileSystem,
    })) || [],
    raid_config: undefined, // Not available from NinjaOne
    is_virtual: isVirtual,
    hypervisor: isVirtual ? device.nodeClass.includes('VMWARE') ? 'VMware' : 'Hyper-V' : undefined,
    network_interfaces: mapNetworkInterfaces(device.networkInterfaces),
    primary_ip: device.networkInterfaces?.[0]?.ipAddresses?.[0],
    installed_services: [], // Would need to fetch separately
    // RMM-specific fields
    agent_version: undefined,
    antivirus_status: antivirus.status,
    antivirus_product: antivirus.product,
    last_reboot_at: device.os?.lastBootTime,
    pending_patches: undefined,
    failed_patches: undefined,
    last_patch_scan_at: undefined,
    system_info: {
      manufacturer: device.system?.manufacturer,
      model: device.system?.model,
      domain: device.system?.domain,
      dns_name: device.dnsName,
      public_ip: device.publicIP,
      timezone: device.os?.timezone?.name,
    },
    disk_usage: mapDiskUsage(device.volumes),
    cpu_usage_percent: undefined, // Would need real-time metrics
    memory_usage_percent: undefined,
  };
}

/**
 * Map NinjaOne device to network device extension data
 */
export function mapToNetworkDeviceExtension(
  device: NinjaOneDeviceDetail
): Partial<NetworkDeviceAsset> {
  return {
    device_type: 'switch', // Default, NMS devices don't have detailed type info
    management_ip: device.networkInterfaces?.[0]?.ipAddresses?.[0] || '',
    port_count: 0, // Not available from NinjaOne
    firmware_version: device.os?.version || '',
    supports_poe: false,
    power_draw_watts: 0,
    vlan_config: {},
    port_config: {},
  };
}

/**
 * Create a full asset request from NinjaOne device
 */
export function mapNinjaOneDeviceToCreateRequest(
  device: NinjaOneDeviceDetail,
  companyId: string,
  integrationId: string
): CreateAssetRequest {
  const baseAsset = mapDeviceToAssetBase(device, companyId, integrationId);
  const assetType = determineAssetType(device.nodeClass);

  const request: CreateAssetRequest = {
    asset_type: assetType,
    client_id: companyId,
    asset_tag: baseAsset.asset_tag!,
    name: baseAsset.name!,
    status: baseAsset.status!,
    location: baseAsset.location,
    serial_number: baseAsset.serial_number,
  };

  // Add extension data based on asset type
  switch (assetType) {
    case 'workstation':
      request.workstation = mapToWorkstationExtension(device) as any;
      break;
    case 'server':
      request.server = mapToServerExtension(device) as any;
      break;
    case 'network_device':
      request.network_device = mapToNetworkDeviceExtension(device) as any;
      break;
  }

  return request;
}

/**
 * Calculate changes between existing asset and NinjaOne device
 */
export function calculateAssetChanges(
  existingAsset: Asset,
  device: NinjaOneDeviceDetail
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  // Check basic fields
  const newName = device.displayName || device.systemName || existingAsset.name;
  if (existingAsset.name !== newName) {
    changes['name'] = { old: existingAsset.name, new: newName };
  }

  const newStatus = mapAgentStatus(device.offline);
  if (existingAsset.agent_status !== newStatus) {
    changes['agent_status'] = { old: existingAsset.agent_status, new: newStatus };
  }

  const newSerialNumber = device.system?.serialNumber || device.system?.biosSerialNumber;
  if (existingAsset.serial_number !== newSerialNumber && newSerialNumber) {
    changes['serial_number'] = { old: existingAsset.serial_number, new: newSerialNumber };
  }

  // Additional field comparisons could be added here

  return changes;
}

/**
 * Result of mapping a device
 */
export interface DeviceMappingResult {
  success: boolean;
  assetType: AlgaAssetType;
  createRequest?: CreateAssetRequest;
  baseFields?: Partial<Asset>;
  extensionFields?: Partial<WorkstationAsset | ServerAsset | NetworkDeviceAsset>;
  error?: string;
}

/**
 * Map a NinjaOne device with full error handling
 */
export function mapDevice(
  device: NinjaOneDeviceDetail,
  companyId: string,
  integrationId: string
): DeviceMappingResult {
  try {
    const assetType = determineAssetType(device.nodeClass);
    const baseFields = mapDeviceToAssetBase(device, companyId, integrationId);

    let extensionFields: Partial<WorkstationAsset | ServerAsset | NetworkDeviceAsset> | undefined;

    switch (assetType) {
      case 'workstation':
        extensionFields = mapToWorkstationExtension(device);
        break;
      case 'server':
        extensionFields = mapToServerExtension(device);
        break;
      case 'network_device':
        extensionFields = mapToNetworkDeviceExtension(device);
        break;
    }

    const createRequest = mapNinjaOneDeviceToCreateRequest(device, companyId, integrationId);

    return {
      success: true,
      assetType,
      createRequest,
      baseFields,
      extensionFields,
    };
  } catch (error) {
    return {
      success: false,
      assetType: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
