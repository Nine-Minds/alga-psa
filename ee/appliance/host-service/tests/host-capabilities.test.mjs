import test from 'node:test';
import assert from 'node:assert/strict';
import { assessHostCapabilities, computeDiskWriteLatency, createDiskLatencyMonitor } from '../host-capabilities.mjs';

const cpuinfo = (model, flags) => `processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: ${model}\nflags\t\t: ${flags}\n\nprocessor\t: 1\nmodel name\t: ${model}\nflags\t\t: ${flags}\n`;
const reader = (text) => () => text;

// The flag set a customer appliance reported on Proxmox's default CPU type (x86-64-v2-AES).
const PROXMOX_V2_AES = cpuinfo(
  'QEMU Virtual CPU version 2.5+',
  'fpu de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx lm constant_tsc nopl xtopology cpuid tsc_known_freq pni ssse3 cx16 sse4_1 sse4_2 x2apic popcnt aes hypervisor lahf_lm cpuid_fault pti'
);

const HOST_PASSTHROUGH = cpuinfo(
  'AMD EPYC 7543 32-Core Processor',
  'fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx mmxext fxsr_opt pdpe1gb rdtscp lm rep_good nopl cpuid extd_apicid tsc_known_freq pni pclmulqdq ssse3 fma cx16 pcid sse4_1 sse4_2 x2apic movbe popcnt aes xsave avx f16c rdrand hypervisor lahf_lm cmp_legacy abm sse4a bmi1 avx2 smep bmi2 erms invpcid rdseed adx smap clflushopt clwb sha_ni xsaveopt'
);

test('Proxmox x86-64-v2-AES CPU type warns about the missing pclmulqdq and avx2', () => {
  const result = assessHostCapabilities({ readFile: reader(PROXMOX_V2_AES), arch: 'x64' });
  assert.deepEqual(result.missing, ['pclmulqdq', 'avx2']);
  assert.equal(result.flags.aes, true);
  assert.equal(result.flags.rdrand, false);
  assert.equal(result.hypervisor, true);
  assert.equal(result.genericCpuModel, true);
  assert.equal(result.warnings.length, 1);
  const [warning] = result.warnings;
  assert.equal(warning.component, 'host');
  assert.match(warning.reason, /pclmulqdq, avx2/);
  assert.match(warning.reason, /AES-GCM/);
  assert.match(warning.reason, /QEMU Virtual CPU version 2\.5\+/);
  assert.match(warning.nextAction, /`host`/);
});

test('a host-passthrough CPU produces no warning', () => {
  const result = assessHostCapabilities({ readFile: reader(HOST_PASSTHROUGH), arch: 'x64' });
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.genericCpuModel, false);
});

test('non-x86 hosts and unreadable cpuinfo never warn', () => {
  assert.deepEqual(assessHostCapabilities({ readFile: reader(PROXMOX_V2_AES), arch: 'arm64' }).warnings, []);
  const unreadable = assessHostCapabilities({ readFile: () => { throw new Error('EACCES'); }, arch: 'x64' });
  assert.equal(unreadable.readable, false);
  assert.deepEqual(unreadable.warnings, []);
});

// diskstats rows: major minor name reads rmerged rsect rms writes wmerged wsect wms ...
const diskstats = (writes, writeMs, partWrites = 0) =>
  `   8       0 sda 100 0 800 50 ${writes} 0 0 ${writeMs} 0 0 0\n` +
  `   8       1 sda1 10 0 80 5 ${partWrites} 0 0 ${partWrites * 1000} 0 0 0\n` +
  `   7       0 loop0 5 0 10 1 0 0 0 0 0 0 0\n`;

test('write latency is computed from the whole disk, ignoring partitions', () => {
  const latency = computeDiskWriteLatency(diskstats(1000, 10_000, 1), diskstats(1165, 17_012, 999));
  assert.equal(latency.device, 'sda');
  assert.equal(latency.writes, 165);
  assert.equal(Math.round(latency.writeAwaitMs * 10) / 10, 42.5);
});

test('disk latency warns only after sustained slow intervals with enough writes', () => {
  const samples = [
    diskstats(0, 0),
    diskstats(200, 8_000),   // 40 ms
    diskstats(210, 9_000),   // 10 writes: skipped, streak kept
    diskstats(410, 17_000),  // 40 ms
    diskstats(610, 25_000)   // 40 ms -> third slow interval
  ];
  let i = 0;
  const monitor = createDiskLatencyMonitor({ readFile: () => samples[i++] });
  const results = samples.map(() => monitor.sample());
  assert.deepEqual(results.slice(0, 4).map((r) => r.warnings.length), [0, 0, 0, 0]);
  assert.equal(results[4].warnings.length, 1);
  assert.match(results[4].warnings[0].reason, /sda .* 40 ms/);
});

test('a fast interval resets the slow streak', () => {
  const samples = [diskstats(0, 0), diskstats(200, 8_000), diskstats(400, 16_000), diskstats(600, 16_200), diskstats(800, 24_200)];
  let i = 0;
  const monitor = createDiskLatencyMonitor({ readFile: () => samples[i++] });
  const results = samples.map(() => monitor.sample());
  assert.ok(results.every((r) => r.warnings.length === 0));
});
