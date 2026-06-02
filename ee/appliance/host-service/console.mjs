#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tokenPath = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const port = Number(process.env.ALGA_APPLIANCE_PORT || 8080);
const issueFile = process.env.ALGA_APPLIANCE_ISSUE_FILE || '/etc/issue';
const motdFile = process.env.ALGA_APPLIANCE_MOTD_FILE || '/etc/motd';
const runBannerFile = process.env.ALGA_APPLIANCE_RUN_BANNER_FILE || '/run/alga-appliance-setup.txt';
const buildInfoFile = process.env.ALGA_APPLIANCE_BUILD_INFO_FILE || '/etc/alga-appliance/build-info.json';
const consoleTtys = (process.env.ALGA_APPLIANCE_CONSOLE_TTYS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function buildTimestampLine() {
  const buildInfo = readJson(buildInfoFile);
  if (buildInfo && typeof buildInfo.buildTimestamp === 'string' && buildInfo.buildTimestamp) {
    return `Build timestamp: ${buildInfo.buildTimestamp}`;
  }
  return 'Build timestamp: unavailable';
}

function detectIp() {
  let nets = {};
  try {
    nets = os.networkInterfaces();
  } catch {
    return '127.0.0.1';
  }
  for (const entries of Object.values(nets)) {
    for (const addr of entries || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

const ip = detectIp();
const token = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8').trim() : '<pending>';

const lines = [
  'Alga Appliance setup handoff',
  `Node IP: ${ip}`,
  buildTimestampLine(),
  'Bootstrap layers:',
  '  1. k3s substrate starting/ready on this host',
  '  2. baked Kubernetes control plane applying from /opt/alga-appliance/control-plane',
  '  3. setup UI served by the Kubernetes-hosted control plane',
  `Setup URL: http://${ip}:${port}/`,
  `One-time setup token: ${token}`,
  'Enter this token once at the setup page, then choose a management password.',
  'Web setup on port 8080 is the primary path.',
  '',
  'Sign in to this host with the account you created during installation.',
  'Forgot the management password? sudo alga-appliance-reset-admin',
  '',
  'If the console is cleared, press Enter or reopen the VM console to redisplay this banner.',
  'Control-plane recovery: sudo /opt/alga-appliance/bin/alga-control-plane-reapply',
  'Console setup fallback: sudo /usr/bin/env node /opt/alga-appliance/host-service/console-setup.mjs',
  'For logs: sudo journalctl -u alga-appliance-bootstrap.service -u alga-appliance-console.service -u alga-host-agent.service -u k3s -f'
];

const banner = lines.join('\n');
const beginMarker = '### BEGIN ALGA APPLIANCE SETUP ###';
const endMarker = '### END ALGA APPLIANCE SETUP ###';

function writeManagedBlock(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const block = `${beginMarker}\n${content}\n${endMarker}`;
    const pattern = new RegExp(`${beginMarker}[\\s\\S]*?${endMarker}`);
    const next = pattern.test(existing)
      ? existing.replace(pattern, block)
      : `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
    fs.writeFileSync(file, next, { mode: 0o644 });
  } catch (error) {
    process.stderr.write(`warning: unable to write ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function writePlainFile(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${content}\n`, { mode: 0o644 });
  } catch (error) {
    process.stderr.write(`warning: unable to write ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function writeConsoleTtys(content) {
  const payload = `\n${content}\n\n`;
  for (const tty of consoleTtys) {
    try {
      if (fs.existsSync(tty)) {
        fs.appendFileSync(tty, payload);
      }
    } catch (error) {
      process.stderr.write(`warning: unable to write ${tty}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

writeManagedBlock(issueFile, banner);
writeManagedBlock(motdFile, banner);
writePlainFile(runBannerFile, banner);
writeConsoleTtys(banner);

process.stdout.write(`\n${banner}\n\n`);
