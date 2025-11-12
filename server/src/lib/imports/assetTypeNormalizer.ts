import { ASSET_TYPE_VALUES } from './assetFieldDefinitions';

const VALID_TYPES = new Set(ASSET_TYPE_VALUES);

const TYPE_ALIASES: Record<string, typeof ASSET_TYPE_VALUES[number]> = {
  desktop: 'workstation',
  workstation: 'workstation',
  laptop: 'workstation',
  notebook: 'workstation',
  endpoint: 'workstation',
  server: 'server',
  'virtual server': 'server',
  vm: 'server',
  hypervisor: 'server',
  router: 'network_device',
  switch: 'network_device',
  firewall: 'network_device',
  'access point': 'network_device',
  ap: 'network_device',
  gateway: 'network_device',
  modem: 'network_device',
  printer: 'printer',
  copier: 'printer',
  mfp: 'printer',
  multifunction: 'printer',
  mobile: 'mobile_device',
  tablet: 'mobile_device',
  smartphone: 'mobile_device',
  phone: 'mobile_device',
  ios: 'mobile_device',
  android: 'mobile_device'
};

/**
 * Normalise vendor-specific device type strings into canonical asset type values.
 */
export const normalizeRmmAssetType = (
  value: unknown
): typeof ASSET_TYPE_VALUES[number] => {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 'unknown';
  }

  const lower = trimmed.toLowerCase();
  if (VALID_TYPES.has(lower as typeof ASSET_TYPE_VALUES[number])) {
    return lower as typeof ASSET_TYPE_VALUES[number];
  }

  return TYPE_ALIASES[lower] ?? 'unknown';
};
