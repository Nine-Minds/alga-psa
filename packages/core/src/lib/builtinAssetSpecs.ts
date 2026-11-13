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
  /**
   * Set when the value belongs on a column of the base `assets` row instead of the
   * type's extension table (e.g. workstation/server/network_device have no `model`
   * column, so their Model spec lands on `assets.model`).
   */
  baseColumn?: string;
}

const OS_FIELDS: AssetSpecField[] = [
  { key: 'os_type', labelKey: 'osType', label: 'OS Type', options: 'os' },
  { key: 'os_version', labelKey: 'osVersion', label: 'OS Version' },
];
/** Model for asset types whose extension table has no `model` column. */
const BASE_MODEL_FIELD: AssetSpecField = { key: 'model', labelKey: 'model', label: 'Model', baseColumn: 'model' };
/** Model for asset types that carry their own `model` column (mobile_device, printer). */
const EXTENSION_MODEL_FIELD: AssetSpecField = { key: 'model', labelKey: 'model', label: 'Model' };
const CPU_FIELDS: AssetSpecField[] = [
  { key: 'cpu_model', labelKey: 'cpuModel', label: 'CPU Model' },
  { key: 'cpu_cores', labelKey: 'cpuCores', label: 'CPU Cores', type: 'number' },
  { key: 'ram_gb', labelKey: 'ramGb', label: 'RAM (GB)', type: 'number' },
];

export const BUILTIN_ASSET_SPEC_FIELDS: Record<string, readonly AssetSpecField[]> = {
  workstation: [
    BASE_MODEL_FIELD,
    ...OS_FIELDS,
    ...CPU_FIELDS,
    { key: 'storage_type', labelKey: 'storageType', label: 'Storage Type', options: 'storage' },
    { key: 'storage_capacity_gb', labelKey: 'storageCapacityGb', label: 'Storage Capacity (GB)', type: 'number' },
    { key: 'gpu_model', labelKey: 'gpuModel', label: 'GPU Model' },
  ],
  network_device: [
    BASE_MODEL_FIELD,
    { key: 'device_type', labelKey: 'deviceType', label: 'Device Type', options: 'network', defaultValue: 'switch' },
    { key: 'management_ip', labelKey: 'managementIp', label: 'Management IP' },
    { key: 'port_count', labelKey: 'portCount', label: 'Port Count', type: 'number' },
    { key: 'firmware_version', labelKey: 'firmwareVersion', label: 'Firmware Version' },
    { key: 'power_draw_watts', labelKey: 'powerDrawWatts', label: 'Power Draw (Watts)', type: 'number' },
    { key: 'supports_poe', labelKey: 'supportsPoe', label: 'Supports PoE', type: 'boolean' },
  ],
  server: [
    BASE_MODEL_FIELD,
    ...OS_FIELDS,
    ...CPU_FIELDS,
    { key: 'primary_ip', labelKey: 'primaryIp', label: 'Primary IP' },
    { key: 'raid_config', labelKey: 'raidConfig', label: 'RAID Config' },
    { key: 'is_virtual', labelKey: 'virtualMachine', label: 'Virtual Machine', type: 'boolean' },
    { key: 'hypervisor', labelKey: 'hypervisor', label: 'Hypervisor', when: 'is_virtual' },
  ],
  mobile_device: [
    EXTENSION_MODEL_FIELD,
    { key: 'os_type', labelKey: 'osType', label: 'OS Type', options: 'mobileOs' },
    { key: 'os_version', labelKey: 'osVersion', label: 'OS Version' },
    { key: 'imei', labelKey: 'imei', label: 'IMEI' },
    { key: 'phone_number', labelKey: 'phoneNumber', label: 'Phone Number' },
    { key: 'carrier', labelKey: 'carrier', label: 'Carrier' },
    { key: 'is_supervised', labelKey: 'supervisedDevice', label: 'Supervised Device', type: 'boolean' },
  ],
  printer: [
    EXTENSION_MODEL_FIELD,
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

export interface PartitionedAssetSpecValues {
  /** Values that belong on the base `assets` row, keyed by base column name. */
  base: Record<string, string | number | boolean>;
  /** Values that belong on the type extension table, keyed by spec key. */
  extension: AssetSpecValues;
}

/**
 * Split normalized spec values into base-row values (fields carrying a
 * `baseColumn`, e.g. Model on `assets.model`) and extension-table values.
 * Types with no `baseColumn`-marked field produce an empty `base` map, so
 * their extension payload stays byte-for-byte identical to a pre-split build.
 */
export function partitionAssetSpecValues(assetType: string, values: AssetSpecValues): PartitionedAssetSpecValues {
  const base: Record<string, string | number | boolean> = {};
  const extension: AssetSpecValues = {};
  const fields = Object.hasOwn(BUILTIN_ASSET_SPEC_FIELDS, assetType) ? BUILTIN_ASSET_SPEC_FIELDS[assetType] : [];
  for (const field of fields) {
    if (!Object.hasOwn(values, field.key)) continue;
    const value = values[field.key];
    if (field.baseColumn) {
      // Empty base values stay unset so the asset column keeps its own default.
      if (value == null || value === '') continue;
      if (Object.hasOwn(base, field.baseColumn)) {
        throw new Error(`Asset spec type ${assetType} maps two fields to base column '${field.baseColumn}'.`);
      }
      base[field.baseColumn] = value;
    } else {
      // Extension values pass through untouched (nulls included) so the parsed
      // payload keeps every column the extension schema requires.
      extension[field.key] = value;
    }
  }
  return { base, extension };
}
