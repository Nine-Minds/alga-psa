import type { LevelDevice, LevelEmulatorCore } from './core';

/**
 * Level's documented automation system variables
 * (docs.level.io/en/articles/11321970-system-variables). Values the device has
 * not reported render as an empty string, and booleans render as the text
 * "true"/"false".
 */
export const SYSTEM_VARIABLE_NAMES = [
  'level_time',
  'level_device_id',
  'level_device_hostname',
  'level_device_nickname',
  'level_device_public_ip_address',
  'level_device_private_ip_addresses',
  'level_device_architecture',
  'level_device_cpu_cores',
  'level_device_memory',
  'level_device_memory_formatted',
  'level_device_os',
  'level_device_os_version',
  'level_device_manufacturer',
  'level_device_model',
  'level_device_last_boot_at',
  'level_device_last_seen_at',
  'level_device_first_seen_at',
  'level_device_online',
  'level_device_maintenance_mode',
  'level_device_restart_required',
  'level_group_id',
  'level_group_name',
  'level_group_path',
  'level_tag_names',
  'level_tag_ids',
] as const;

export type SystemVariableName = (typeof SYSTEM_VARIABLE_NAMES)[number];

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** "16 GB" style; Level's exact rounding is undocumented. */
export function formatMemory(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || Number.isInteger(value) ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

function privateIps(device: LevelDevice): string {
  const interfaces = (device.network_interfaces ?? []) as Array<{ ip_addresses?: unknown }>;
  return interfaces
    .flatMap((iface) => (Array.isArray(iface.ip_addresses) ? iface.ip_addresses.map(String) : []))
    .join(',');
}

/** Every system variable for a device at the current virtual time. */
export function systemVariables(core: LevelEmulatorCore, deviceId: string): Record<SystemVariableName, string> {
  const device = core.getDevice(deviceId);
  const facts = core.deviceFacts.get(deviceId);
  const group = device.group_id ? core.groups.get(device.group_id) : undefined;
  const os = (device.operating_system ?? {}) as { full_operating_system?: unknown; minor_version?: unknown; major_version?: unknown };
  const now = core.now().toISOString();
  return {
    level_time: now,
    level_device_id: device.id,
    level_device_hostname: device.hostname,
    level_device_nickname: text(device.nickname),
    level_device_public_ip_address: text(facts?.publicIpAddress),
    level_device_private_ip_addresses: privateIps(device),
    level_device_architecture: text(device.architecture),
    level_device_cpu_cores: text(device.cpu_cores),
    level_device_memory: text(device.total_memory),
    level_device_memory_formatted: formatMemory(device.total_memory),
    level_device_os: text(os.full_operating_system),
    level_device_os_version: text(os.minor_version ?? os.major_version),
    level_device_manufacturer: text(device.manufacturer),
    level_device_model: text(device.model),
    level_device_last_boot_at: text(device.last_reboot_time),
    level_device_last_seen_at: device.online ? now : text(device.last_seen_at),
    level_device_first_seen_at: text(facts?.firstSeenAt),
    level_device_online: String(device.online),
    level_device_maintenance_mode: String(device.maintenance_mode),
    level_device_restart_required: String(facts?.restartRequired ?? false),
    level_group_id: group?.id ?? '',
    level_group_name: group?.name ?? '',
    level_group_path: core.groupPath(device.group_id),
    level_tag_names: device.tags.join(','),
    level_tag_ids: device.tags.map((tag) => core.tagId(tag)).join(','),
  };
}

const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

export interface RenderResult {
  text: string;
  /** Token names that matched no variable and were left in place verbatim. */
  unresolved: string[];
}

/**
 * Substitutes `{{name}}` tokens. A token naming no known variable stays in the
 * output as literal text — the behavior observed from Level in production,
 * where `{{alert_id}}` arrived at Alga unrendered.
 */
export function renderTemplate(template: string, variables: Record<string, string>): RenderResult {
  const unresolved: string[] = [];
  const text = template.replace(TOKEN, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name];
    if (!unresolved.includes(name)) unresolved.push(name);
    return match;
  });
  return { text, unresolved };
}
