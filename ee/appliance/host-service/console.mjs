#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tokenPath = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const port = Number(process.env.ALGA_APPLIANCE_PORT || 8080);
const issueFile = process.env.ALGA_APPLIANCE_ISSUE_FILE || '/etc/issue';
const motdFile = process.env.ALGA_APPLIANCE_MOTD_FILE || '/etc/motd';
const runBannerFile = process.env.ALGA_APPLIANCE_RUN_BANNER_FILE || '/run/alga-appliance-setup.txt';

function detectIp() {
  const nets = os.networkInterfaces();
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
  'Alga Appliance setup is ready',
  `Node IP: ${ip}`,
  `Setup URL: http://${ip}:${port}/setup?token=${token}`,
  `Setup token: ${token}`,
  'Web setup is the primary path.',
  'Console setup fallback: /usr/bin/env node /opt/alga-appliance/host-service/console-setup.mjs',
  'For logs: journalctl -u alga-appliance.service -u alga-appliance-console.service -f'
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

writeManagedBlock(issueFile, banner);
writeManagedBlock(motdFile, banner);
writePlainFile(runBannerFile, banner);

process.stdout.write(`\n${banner}\n\n`);
