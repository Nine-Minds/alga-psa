#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tokenPath = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const port = Number(process.env.ALGA_APPLIANCE_PORT || 8080);
const issueFile = process.env.ALGA_APPLIANCE_ISSUE_FILE || '/etc/issue';
const motdFile = process.env.ALGA_APPLIANCE_MOTD_FILE || '/etc/motd';
const runBannerFile = process.env.ALGA_APPLIANCE_RUN_BANNER_FILE || '/run/alga-appliance-setup.txt';
const adminUser = process.env.ALGA_APPLIANCE_ADMIN_USER || 'alga-admin';
const adminPasswordFile = process.env.ALGA_APPLIANCE_ADMIN_PASSWORD_FILE || '/var/lib/alga-appliance/admin-password';
const adminPasswordStateFile = process.env.ALGA_APPLIANCE_ADMIN_PASSWORD_STATE_FILE || '/var/lib/alga-appliance/admin-password-state.json';

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeSecureJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(path.dirname(file), 0o750);
  fs.chmodSync(file, 0o600);
}

function passwordStillRequiresChange(user) {
  const result = spawnSync('chage', ['-l', user], { encoding: 'utf8' });
  if (result.status !== 0) {
    return true;
  }
  return /password must be changed/i.test(`${result.stdout}\n${result.stderr}`);
}

function adminCredentialLines() {
  const state = readJson(adminPasswordStateFile);
  if (state?.status === 'temporary' && fs.existsSync(adminPasswordFile)) {
    if (!passwordStillRequiresChange(adminUser)) {
      try { fs.unlinkSync(adminPasswordFile); } catch {}
      writeSecureJson(adminPasswordStateFile, {
        ...state,
        status: 'configured',
        configuredAt: new Date().toISOString(),
        changeRequired: false
      });
      return [
        'Local administration:',
        `  User: ${adminUser}`,
        '  Password: configured'
      ];
    }

    const temporaryPassword = fs.readFileSync(adminPasswordFile, 'utf8').trim();
    return [
      'Local administration:',
      `  User: ${adminUser}`,
      `  Temporary password: ${temporaryPassword}`,
      '  Password change required on first login.'
    ];
  }

  return [
    'Local administration:',
    `  User: ${adminUser}`,
    state?.status === 'configured' ? '  Password: configured' : '  Password: initialize pending'
  ];
}

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
  '',
  ...adminCredentialLines(),
  '',
  'If the console is cleared, press Enter or reopen the VM console to redisplay this banner.',
  'Console setup fallback: sudo /usr/bin/env node /opt/alga-appliance/host-service/console-setup.mjs',
  'For logs: sudo journalctl -u alga-appliance.service -u alga-appliance-console.service -f'
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
