import { describe, expect, it } from 'vitest';

import {
  buildTacticalExtensionPatch,
  extractHardware,
  extractVitals,
  parseTacticalSizeToGb,
} from '@alga-psa/integrations/lib/rmm/tacticalrmm/deviceSync';

const NOW = new Date('2026-09-09T12:00:00.000Z');

// Shape of /beta/v1/agent/ (ListAgentSerializer, fields="__all__"): model
// fields only — cpu_model / serial_number / local_ips are properties and absent.
const windowsListAgent = {
  id: 7,
  agent_id: 'PyjIdHUznIerxVrjXZFKROyAQROFZctXxWqfnRIA',
  hostname: 'DESKTOP-6IAGKQ6',
  plat: 'windows',
  operating_system: 'Windows 11 Home, 64 bit v25H2 (build 26200.1234)',
  version: '2.11.0',
  last_seen: '2026-09-09T11:58:00Z',
  public_ip: '203.0.113.9',
  total_ram: 16,
  boot_time: 1757400000, // 2025-09-09T07:20:00Z
  logged_in_username: 'robin',
  disks: [
    { device: 'C:', fstype: 'NTFS', total: '476.9 GB', used: '210.3 GB', free: '266.6 GB', percent: 44 },
    { device: 'D:', fstype: 'NTFS', total: '2.0 TB', used: '1.0 TB', free: '1.0 TB', percent: 50 },
  ],
  wmi_detail: {
    cpu: [[{ Name: 'Intel(R) Core(TM) i7-12700 ', NumberOfCores: 12, NumberOfLogicalProcessors: 20 }]],
    bios: [[{ SerialNumber: 'ABC123XYZ', Manufacturer: 'Dell' }]],
    network_config: [
      [{ IPAddress: null }],
      [{ IPAddress: ['192.168.1.42', 'fe80::1'] }],
    ],
  },
};

// Shape of /beta/v1/agent/{agent_id}/ (DetailAgentSerializer): properties present.
const windowsDetailAgent = {
  ...windowsListAgent,
  cpu_model: ['Intel(R) Core(TM) i7-12700, 12C/20T'],
  serial_number: 'ABC123XYZ',
  local_ips: '192.168.1.42, 10.0.0.5',
  status: 'online',
};

const linuxListAgent = {
  agent_id: 'lnx1',
  hostname: 'ubuntu-box',
  plat: 'linux',
  operating_system: 'Ubuntu 24.04 LTS',
  total_ram: 8,
  boot_time: 1757400000,
  disks: [{ device: '/', fstype: 'ext4', total: '98.3 GB', used: '40.1 GB', free: '58.2 GB', percent: 41 }],
  wmi_detail: {
    cpus: ['AMD Ryzen 5 5600G'],
    serialnumber: 'LNX-SERIAL-1',
    local_ips: ['10.1.2.3'],
  },
};

describe('parseTacticalSizeToGb', () => {
  it('parses ByteCountSI strings and raw byte numbers', () => {
    expect(parseTacticalSizeToGb('476.9 GB')).toBe(476.9);
    expect(parseTacticalSizeToGb('2.0 TB')).toBe(2000);
    expect(parseTacticalSizeToGb('512 MB')).toBe(0.5);
    expect(parseTacticalSizeToGb(476_900_000_000)).toBe(476.9);
    expect(parseTacticalSizeToGb('n/a')).toBeNull();
    expect(parseTacticalSizeToGb(undefined)).toBeNull();
  });
});

describe('extractVitals (Tactical payloads)', () => {
  it('derives uptime from boot_time and LAN IP from wmi_detail on the list payload', () => {
    const v = extractVitals(windowsListAgent, NOW);
    expect(v.current_user).toBe('robin');
    expect(v.wan_ip).toBe('203.0.113.9');
    expect(v.lan_ip).toBe('192.168.1.42');
    expect(v.uptime_seconds).toBe(Math.floor((NOW.getTime() - 1757400000 * 1000) / 1000));
  });

  it('prefers local_ips from the detail payload', () => {
    expect(extractVitals(windowsDetailAgent, NOW).lan_ip).toBe('192.168.1.42');
  });

  it('ignores the "error getting local ips" sentinel', () => {
    const v = extractVitals({ ...windowsDetailAgent, local_ips: 'error getting local ips', wmi_detail: null }, NOW);
    expect(v.lan_ip).toBeNull();
  });

  it('reads posix local_ips list', () => {
    expect(extractVitals(linuxListAgent, NOW).lan_ip).toBe('10.1.2.3');
  });
});

describe('extractHardware (Tactical payloads)', () => {
  it('maps CPU, cores, RAM, disks, serial and last reboot from the list payload via wmi_detail', () => {
    const h = extractHardware(windowsListAgent);
    expect(h.cpu_model).toBe('Intel(R) Core(TM) i7-12700');
    expect(h.cpu_cores).toBe(12);
    expect(h.ram_gb).toBe(16);
    expect(h.serial_number).toBe('ABC123XYZ');
    expect(h.last_reboot_at?.toISOString()).toBe(new Date(1757400000 * 1000).toISOString());
    expect(h.disk_usage).toEqual([
      { name: 'C:', total_gb: 476.9, free_gb: 266.6, utilization_percent: 44 },
      { name: 'D:', total_gb: 2000, free_gb: 1000, utilization_percent: 50 },
    ]);
  });

  it('maps the same facts from the detail payload, parsing cores out of the cpu_model string', () => {
    const h = extractHardware(windowsDetailAgent);
    expect(h.cpu_model).toBe('Intel(R) Core(TM) i7-12700, 12C/20T');
    expect(h.cpu_cores).toBe(12);
    expect(h.serial_number).toBe('ABC123XYZ');
  });

  it('maps posix agents from wmi_detail.cpus / serialnumber', () => {
    const h = extractHardware(linuxListAgent);
    expect(h.cpu_model).toBe('AMD Ryzen 5 5600G');
    expect(h.cpu_cores).toBeNull();
    expect(h.ram_gb).toBe(8);
    expect(h.serial_number).toBe('LNX-SERIAL-1');
    expect(h.disk_usage).toEqual([{ name: '/', total_gb: 98.3, free_gb: 58.2, utilization_percent: 41 }]);
  });

  it('treats Tactical\'s "unknown cpu model" and empty serial as absent', () => {
    const h = extractHardware({ plat: 'windows', cpu_model: ['unknown cpu model'], serial_number: '', wmi_detail: { bios: [[{ SerialNumber: '' }]] } });
    expect(h.cpu_model).toBeNull();
    expect(h.serial_number).toBeNull();
  });
});

describe('buildTacticalExtensionPatch', () => {
  it('includes hardware columns only when the payload carried them', () => {
    const rich = buildTacticalExtensionPatch(windowsListAgent, NOW);
    expect(rich).toMatchObject({
      os_type: 'Windows',
      agent_version: '2.11.0',
      current_user: 'robin',
      lan_ip: '192.168.1.42',
      wan_ip: '203.0.113.9',
      cpu_model: 'Intel(R) Core(TM) i7-12700',
      cpu_cores: 12,
      ram_gb: 16,
    });
    expect(JSON.parse(String(rich.disk_usage))).toHaveLength(2);
    expect(rich.last_reboot_at).toBeInstanceOf(Date);

    const thin = buildTacticalExtensionPatch({ agent_id: 'x', hostname: 'x', operating_system: 'Windows 10' }, NOW);
    expect(thin).not.toHaveProperty('cpu_model');
    expect(thin).not.toHaveProperty('cpu_cores');
    expect(thin).not.toHaveProperty('ram_gb');
    expect(thin).not.toHaveProperty('disk_usage');
    expect(thin).not.toHaveProperty('last_reboot_at');
    expect(thin.uptime_seconds).toBeNull();
    expect(thin.lan_ip).toBeNull();
  });
});
