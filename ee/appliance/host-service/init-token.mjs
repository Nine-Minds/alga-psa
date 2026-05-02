#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const tokenFile = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const parentDir = path.dirname(tokenFile);

if (!fs.existsSync(parentDir)) {
  fs.mkdirSync(parentDir, { recursive: true, mode: 0o750 });
}

try {
  fs.chmodSync(parentDir, 0o750);
} catch {
  // Best-effort in local dev; installer creates root-owned dirs in production.
}

if (!fs.existsSync(tokenFile)) {
  const token = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
}

try {
  fs.chmodSync(tokenFile, 0o600);
} catch {
  // Best-effort in local dev.
}
