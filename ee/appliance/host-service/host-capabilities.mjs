// Host hardware checks surfaced on the status page.
//
// Hypervisor defaults quietly cost the appliance a lot of throughput. Proxmox's
// default CPU type (x86-64-v2-AES) — and even its x86-64-v3 — omit PCLMULQDQ,
// so Go (k3s, kubectl, Flux) and OpenSSL (Node, Postgres) lose their hardware
// AES-GCM path, and without AVX2 every vectorised code path falls back to
// scalar. A qcow2 disk on spinning or directory-backed storage adds tens of
// milliseconds to every fsync, which stalls the k3s SQLite datastore. Neither
// shows up as an error anywhere, so these checks make them visible.
//
// /proc/cpuinfo and /proc/diskstats are not namespaced: inside the
// control-plane pod they describe the host VM.

import fs from 'node:fs';

const CPUINFO_PATH = '/proc/cpuinfo';
const DISKSTATS_PATH = '/proc/diskstats';

// Flags whose absence has a concrete, measurable cost on the appliance.
const REQUIRED_X86_FLAGS = Object.freeze(['aes', 'pclmulqdq', 'avx2']);
const REPORTED_X86_FLAGS = Object.freeze(['aes', 'pclmulqdq', 'avx', 'avx2', 'sse4_1', 'sse4_2', 'ssse3', 'popcnt', 'rdrand']);

const CPU_TYPE_NEXT_ACTION = 'Set the VM CPU type to `host` (single host), or for live-migration clusters a custom or named CPU model that includes pclmulqdq and avx2, then fully stop and start the VM (a guest reboot does not apply it). On Proxmox the built-in x86-64-v2-AES and x86-64-v3 types both lack pclmulqdq.';

function parseCpuinfo(text) {
  const lines = String(text || '').split('\n');
  // First processor block only; every vCPU reports the same model and flags.
  const field = (name) => {
    const line = lines.find((l) => l.includes(':') && l.slice(0, l.indexOf(':')).trim() === name);
    return line ? line.slice(line.indexOf(':') + 1).trim() : null;
  };
  const flagsLine = field('flags');
  return {
    cpuModel: field('model name'),
    flagSet: new Set(flagsLine ? flagsLine.split(/\s+/).filter(Boolean) : [])
  };
}

function costOfMissing(missing) {
  const costs = [];
  if (missing.includes('aes') || missing.includes('pclmulqdq')) {
    costs.push('no hardware AES-GCM, so TLS in k3s, kubectl, Flux, Node, and Postgres runs in software');
  }
  if (missing.includes('avx2')) {
    costs.push('no AVX2, so vectorised code paths fall back to scalar');
  }
  return costs.join('; ');
}

// Pure assessment of the host CPU. Unreadable cpuinfo or a non-x86 host yields
// no warnings: the check is advisory and must never fail status collection.
export function assessHostCapabilities({
  readFile = fs.readFileSync,
  cpuinfoPath = CPUINFO_PATH,
  arch = process.arch
} = {}) {
  let text;
  try {
    text = readFile(cpuinfoPath, 'utf8');
  } catch {
    return { readable: false, arch, cpuModel: null, flags: {}, hypervisor: null, genericCpuModel: false, missing: [], warnings: [] };
  }

  const { cpuModel, flagSet } = parseCpuinfo(text);
  const isX86 = arch === 'x64' || arch === 'x86_64';
  const flags = Object.fromEntries(REPORTED_X86_FLAGS.map((flag) => [flag, flagSet.has(flag)]));
  const hypervisor = flagSet.has('hypervisor');
  const genericCpuModel = /QEMU Virtual CPU|Common KVM processor/i.test(cpuModel || '');
  const missing = isX86 && flagSet.size > 0 ? REQUIRED_X86_FLAGS.filter((flag) => !flagSet.has(flag)) : [];

  const warnings = [];
  if (missing.length > 0) {
    const model = cpuModel ? ` (reported CPU: ${cpuModel}${genericCpuModel ? ', a generic emulated model' : ''})` : '';
    warnings.push({
      severity: 'warning',
      component: 'host',
      layer: 'host',
      code: 'host-cpu-features-missing',
      reason: `The VM CPU is missing ${missing.join(', ')}${model}: ${costOfMissing(missing)}. Everything on the appliance runs slower than the hardware allows.`,
      nextAction: CPU_TYPE_NEXT_ACTION
    });
  }

  return { readable: true, arch, cpuModel, flags, hypervisor, genericCpuModel, missing, warnings };
}

// CPU flags cannot change while the process runs; read them once.
let cachedAssessment = null;
export function hostCapabilities(options) {
  if (!cachedAssessment) cachedAssessment = assessHostCapabilities(options);
  return cachedAssessment;
}

// --- disk write latency ----------------------------------------------------

// Whole block devices only (no partitions, loop, ram, or device-mapper nodes).
const WHOLE_DISK_RE = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+)$/;

function parseDiskstats(text) {
  const devices = new Map();
  for (const line of String(text || '').split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 11 || !WHOLE_DISK_RE.test(f[2])) continue;
    devices.set(f[2], { writes: Number(f[7]), writeMs: Number(f[10]) });
  }
  return devices;
}

// Average write latency between two /proc/diskstats samples. Picks the whole
// disk with the most writes in the interval unless `device` is given. Returns
// null when there is no comparable device or the counters went backwards.
export function computeDiskWriteLatency(previousText, nextText, { device } = {}) {
  const before = parseDiskstats(previousText);
  const after = parseDiskstats(nextText);
  let best = null;
  for (const [name, next] of after) {
    if (device && name !== device) continue;
    const prev = before.get(name);
    if (!prev) continue;
    const writes = next.writes - prev.writes;
    const writeMs = next.writeMs - prev.writeMs;
    if (writes < 0 || writeMs < 0) continue;
    if (!best || writes > best.writes) best = { device: name, writes, writeMs };
  }
  if (!best) return null;
  return { ...best, writeAwaitMs: best.writes > 0 ? best.writeMs / best.writes : null };
}

// Tracks write latency across successive calls (one per status poll) and warns
// only when it stays high. A single interval with few writes is noise, so an
// interval counts only when it saw at least `minWrites`, and the warning needs
// `sustainSamples` consecutive slow intervals. Intervals below `minWrites` are
// skipped without resetting the streak (an idle disk says nothing either way).
export function createDiskLatencyMonitor({
  readFile = fs.readFileSync,
  diskstatsPath = DISKSTATS_PATH,
  thresholdMs = 20,
  minWrites = 50,
  sustainSamples = 3
} = {}) {
  let previous = null;
  let slowStreak = 0;
  let last = null;

  return {
    sample() {
      let text;
      try {
        text = readFile(diskstatsPath, 'utf8');
      } catch {
        return { readable: false, latest: null, warnings: [] };
      }
      if (previous !== null) {
        const latency = computeDiskWriteLatency(previous, text);
        if (latency && latency.writes >= minWrites) {
          last = latency;
          slowStreak = latency.writeAwaitMs > thresholdMs ? slowStreak + 1 : 0;
        }
      }
      previous = text;

      const warnings = [];
      if (last && slowStreak >= sustainSamples) {
        warnings.push({
          severity: 'warning',
          component: 'host',
          layer: 'host',
          code: 'host-disk-write-latency',
          reason: `Disk writes on ${last.device} are averaging ${Math.round(last.writeAwaitMs)} ms (healthy SSD storage is 1-2 ms). The Kubernetes datastore and Postgres wait on every write, so the whole appliance stalls behind the disk.`,
          nextAction: 'Move the VM disk to SSD or NVMe-backed storage (on Proxmox, raw on LVM-thin or ZFS rather than qcow2 on directory storage). Keep the disk cache mode at the default (none); never use unsafe.'
        });
      }
      return { readable: true, latest: last, slowStreak, warnings };
    }
  };
}
