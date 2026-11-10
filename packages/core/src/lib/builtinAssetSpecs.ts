export const ASSET_SPEC_OPTIONS = {
  os: [
    { value: 'windows', label: 'Windows' },
    { value: 'macos', label: 'macOS' },
    { value: 'linux', label: 'Linux' },
  ],
  storage: [
    { value: 'ssd', label: 'SSD' },
    { value: 'hdd', label: 'HDD' },
    { value: 'nvme', label: 'NVME' },
  ],
  network: [
    { value: 'switch', label: 'Switch' },
    { value: 'router', label: 'Router' },
    { value: 'firewall', label: 'Firewall' },
    { value: 'access_point', label: 'Access Point' },
    { value: 'load_balancer', label: 'Load Balancer' },
  ],
  mobileOs: [
    { value: 'ios', label: 'iOS' },
    { value: 'android', label: 'Android' },
  ],
} as const;

export type AssetSpecOptionGroup = keyof typeof ASSET_SPEC_OPTIONS;
export type AssetSpecValue = string | number | boolean | null;
export type AssetSpecValues = Record<string, AssetSpecValue>;

export interface AssetSpecField {
  key: string;
  labelKey: string;
  label: string;
  type?: 'number' | 'boolean';
  options?: AssetSpecOptionGroup;
  when?: string;
  defaultValue?: AssetSpecValue;
}

const OS_FIELDS: AssetSpecField[] = [
  { key: 'os_type', labelKey: 'osType', label: 'OS Type', options: 'os' },
  { key: 'os_version', labelKey: 'osVersion', label: 'OS Version' },
];
const CPU_FIELDS: AssetSpecField[] = [
  { key: 'cpu_model', labelKey: 'cpuModel', label: 'CPU Model' },
  { key: 'cpu_cores', labelKey: 'cpuCores', label: 'CPU Cores', type: 'number' },
  { key: 'ram_gb', labelKey: 'ramGb', label: 'RAM (GB)', type: 'number' },
];

export const BUILTIN_ASSET_SPEC_FIELDS: Record<string, readonly AssetSpecField[]> = {
  workstation: [
    ...OS_FIELDS,
    ...CPU_FIELDS,
    { key: 'storage_type', labelKey: 'storageType', label: 'Storage Type', options: 'storage' },
    { key: 'storage_capacity_gb', labelKey: 'storageCapacityGb', label: 'Storage Capacity (GB)', type: 'number' },
    { key: 'gpu_model', labelKey: 'gpuModel', label: 'GPU Model' },
  ],
  network_device: [
    { key: 'device_type', labelKey: 'deviceType', label: 'Device Type', options: 'network', defaultValue: 'switch' },
    { key: 'management_ip', labelKey: 'managementIp', label: 'Management IP' },
    { key: 'port_count', labelKey: 'portCount', label: 'Port Count', type: 'number' },
    { key: 'firmware_version', labelKey: 'firmwareVersion', label: 'Firmware Version' },
    { key: 'power_draw_watts', labelKey: 'powerDrawWatts', label: 'Power Draw (Watts)', type: 'number' },
    { key: 'supports_poe', labelKey: 'supportsPoe', label: 'Supports PoE', type: 'boolean' },
  ],
  server: [
    ...OS_FIELDS,
    ...CPU_FIELDS,
    { key: 'primary_ip', labelKey: 'primaryIp', label: 'Primary IP' },
    { key: 'raid_config', labelKey: 'raidConfig', label: 'RAID Config' },
    { key: 'is_virtual', labelKey: 'virtualMachine', label: 'Virtual Machine', type: 'boolean' },
    { key: 'hypervisor', labelKey: 'hypervisor', label: 'Hypervisor', when: 'is_virtual' },
  ],
  mobile_device: [
    { key: 'os_type', labelKey: 'osType', label: 'OS Type', options: 'mobileOs' },
    { key: 'os_version', labelKey: 'osVersion', label: 'OS Version' },
    { key: 'model', labelKey: 'model', label: 'Model' },
    { key: 'imei', labelKey: 'imei', label: 'IMEI' },
    { key: 'phone_number', labelKey: 'phoneNumber', label: 'Phone Number' },
    { key: 'carrier', labelKey: 'carrier', label: 'Carrier' },
    { key: 'is_supervised', labelKey: 'supervisedDevice', label: 'Supervised Device', type: 'boolean' },
  ],
  printer: [
    { key: 'model', labelKey: 'model', label: 'Model' },
    { key: 'ip_address', labelKey: 'ipAddress', label: 'IP Address' },
    { key: 'monthly_duty_cycle', labelKey: 'monthlyDutyCycle', label: 'Monthly Duty Cycle', type: 'number' },
    { key: 'is_network_printer', labelKey: 'networkPrinter', label: 'Network Printer', type: 'boolean' },
    { key: 'supports_color', labelKey: 'colorSupport', label: 'Color Support', type: 'boolean' },
    { key: 'supports_duplex', labelKey: 'duplexSupport', label: 'Duplex Support', type: 'boolean' },
  ],
};

/** Normalize older text-only product defaults without losing numeric or boolean values. */
export function normalizeAssetSpecValues(assetType: string, metadata: Record<string, unknown> | null | undefined): AssetSpecValues {
  if (metadata != null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
    throw new Error(`Invalid default asset specs for ${assetType}: expected an object.`);
  }
  const result: AssetSpecValues = {};
  const fields = Object.hasOwn(BUILTIN_ASSET_SPEC_FIELDS, assetType) ? BUILTIN_ASSET_SPEC_FIELDS[assetType] : [];
  for (const field of fields) {
    const raw = metadata?.[field.key];
    if (raw == null || raw === '') continue;
    const invalid = () => new Error(`Invalid default asset spec ${assetType}.${field.key}: ${field.label} has an invalid value.`);
    if (field.type === 'number') {
      if (typeof raw !== 'number' && typeof raw !== 'string') throw invalid();
      if (typeof raw === 'string' && !raw.trim()) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || (field.key !== 'power_draw_watts'
        && (!Number.isInteger(value) || value > 2147483647))) throw invalid();
      result[field.key] = value;
    } else if (field.type === 'boolean') {
      if (raw !== true && raw !== false && raw !== 'true' && raw !== 'false') throw invalid();
      result[field.key] = raw === true || raw === 'true';
    } else {
      if (typeof raw !== 'string') throw invalid();
      const value = raw.trim();
      if (!value) continue;
      if (field.options) {
        const option = ASSET_SPEC_OPTIONS[field.options].find((item) =>
          item.value.toLowerCase() === value.toLowerCase() || item.label.toLowerCase() === value.toLowerCase());
        if (!option && field.options === 'network') throw invalid();
        result[field.key] = option?.value ?? value;
      } else {
        result[field.key] = value;
      }
    }
  }
  return result;
}
