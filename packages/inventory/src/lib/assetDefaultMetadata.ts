/**
 * product_inventory_settings.default_asset_metadata (F: delivered-asset spec defaults)
 * stores the per-product spec values captured on the Quick Add Product screen so a
 * delivered serialized unit becomes a filled-out asset instead of a blank one.
 *
 * The createAsset extension schemas (workstation/network_device/server/mobile_device/
 * printer) are NON-partial — every required column must be present. So the stored
 * partial values are merged over the same "unknown" fill QuickAddAsset submits
 * (empty strings, null numbers, empty arrays/objects, false booleans — alga0002283:
 * unknown means null, not 0).
 */

const WORKSTATION_FILL = {
  os_type: '',
  os_version: '',
  cpu_model: '',
  cpu_cores: null,
  ram_gb: null,
  storage_type: '',
  storage_capacity_gb: null,
  installed_software: [] as unknown[],
};

const NETWORK_DEVICE_FILL = {
  device_type: 'switch',
  management_ip: '',
  port_count: null,
  firmware_version: '',
  supports_poe: false,
  power_draw_watts: null,
  vlan_config: {},
  port_config: {},
};

const SERVER_FILL = {
  os_type: '',
  os_version: '',
  cpu_model: '',
  cpu_cores: null,
  ram_gb: null,
  storage_config: [] as unknown[],
  is_virtual: false,
  network_interfaces: [] as unknown[],
  installed_services: [] as unknown[],
};

const MOBILE_DEVICE_FILL = {
  os_type: '',
  os_version: '',
  model: '',
  is_supervised: false,
  installed_apps: [] as unknown[],
};

const PRINTER_FILL = {
  model: '',
  is_network_printer: false,
  supports_color: false,
  supports_duplex: false,
  supported_paper_types: [] as unknown[],
  supply_levels: {},
};

const DEVICE_TYPES = ['switch', 'router', 'firewall', 'access_point', 'load_balancer'] as const;

/** The asset types this builder can produce an extension payload for. */
export function hasDefaultAssetExtension(assetType: string): boolean {
  return assetType === 'workstation' || assetType === 'network_device'
    || assetType === 'server' || assetType === 'mobile_device' || assetType === 'printer';
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Compose the complete createAsset extension payload for `assetType` from the product's
 * stored `default_asset_metadata`. Unknown asset types and empty metadata yield null
 * (the asset is created without an extension section, as before).
 */
export function buildDefaultAssetExtension(
  assetType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const m = metadata ?? {};
  switch (assetType) {
    case 'workstation':
      return {
        ...WORKSTATION_FILL,
        os_type: text(m.os_type, WORKSTATION_FILL.os_type),
        os_version: text(m.os_version, WORKSTATION_FILL.os_version),
        cpu_model: text(m.cpu_model, WORKSTATION_FILL.cpu_model),
        storage_type: text(m.storage_type, WORKSTATION_FILL.storage_type),
      };
    case 'network_device': {
      const deviceType = typeof m.device_type === 'string'
        && (DEVICE_TYPES as readonly string[]).includes(m.device_type)
        ? m.device_type
        : NETWORK_DEVICE_FILL.device_type;
      return {
        ...NETWORK_DEVICE_FILL,
        device_type: deviceType,
        management_ip: text(m.management_ip, NETWORK_DEVICE_FILL.management_ip),
        firmware_version: text(m.firmware_version, NETWORK_DEVICE_FILL.firmware_version),
      };
    }
    case 'server':
      return {
        ...SERVER_FILL,
        os_type: text(m.os_type, SERVER_FILL.os_type),
        os_version: text(m.os_version, SERVER_FILL.os_version),
        cpu_model: text(m.cpu_model, SERVER_FILL.cpu_model),
      };
    case 'mobile_device':
      return {
        ...MOBILE_DEVICE_FILL,
        os_type: text(m.os_type, MOBILE_DEVICE_FILL.os_type),
        os_version: text(m.os_version, MOBILE_DEVICE_FILL.os_version),
        model: text(m.model, MOBILE_DEVICE_FILL.model),
        is_supervised: typeof m.is_supervised === 'boolean' ? m.is_supervised : MOBILE_DEVICE_FILL.is_supervised,
      };
    case 'printer':
      return {
        ...PRINTER_FILL,
        model: text(m.model, PRINTER_FILL.model),
      };
    default:
      return null;
  }
}
