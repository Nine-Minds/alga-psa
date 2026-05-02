#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';

const tokenPath = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const port = Number(process.env.ALGA_APPLIANCE_PORT || 8080);

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
  'Alga Appliance console fallback',
  `Node IP: ${ip}`,
  `Setup URL: http://${ip}:${port}/setup`,
  `Setup token: ${token}`,
  'Web setup is the primary path.',
  'For logs: journalctl -u alga-appliance.service -u alga-appliance-console.service -f'
];

process.stdout.write(`\n${lines.join('\n')}\n\n`);
