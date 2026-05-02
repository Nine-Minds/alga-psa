#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const adminUser = process.env.ALGA_APPLIANCE_ADMIN_USER || 'alga-admin';
const passwordFile = process.env.ALGA_APPLIANCE_ADMIN_PASSWORD_FILE || '/var/lib/alga-appliance/admin-password';
const stateFile = process.env.ALGA_APPLIANCE_ADMIN_PASSWORD_STATE_FILE || '/var/lib/alga-appliance/admin-password-state.json';
const dryRun = process.env.ALGA_APPLIANCE_ADMIN_CREDENTIAL_DRY_RUN === '1';

function nowIso() {
  return new Date().toISOString();
}

function generatePassword() {
  // Human-readable enough for console entry, but unique per appliance.
  return crypto.randomBytes(18).toString('base64url').match(/.{1,6}/g).join('-');
}

function writeSecureFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(path.dirname(file), 0o750);
  fs.chmodSync(file, 0o600);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function run(command, args, input) {
  if (dryRun) {
    return { ok: true, status: 0, stdout: '', stderr: '' };
  }

  const result = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    env: process.env
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

const existingState = readJson(stateFile);
if (existingState?.status === 'configured') {
  process.exit(0);
}

if (existingState?.status === 'temporary' && fs.existsSync(passwordFile)) {
  process.exit(0);
}

const temporaryPassword = generatePassword();
writeSecureFile(passwordFile, `${temporaryPassword}\n`);

const chpasswd = run('chpasswd', [], `${adminUser}:${temporaryPassword}\n`);
if (!chpasswd.ok) {
  process.stderr.write(`Failed to set temporary password for ${adminUser}: ${chpasswd.stderr || chpasswd.stdout}\n`);
  process.exit(1);
}

const expire = run('chage', ['-d', '0', adminUser]);
if (!expire.ok) {
  process.stderr.write(`Failed to force password change for ${adminUser}: ${expire.stderr || expire.stdout}\n`);
  process.exit(1);
}

writeSecureFile(stateFile, `${JSON.stringify({
  status: 'temporary',
  user: adminUser,
  passwordFile,
  generatedAt: nowIso(),
  changeRequired: true
}, null, 2)}\n`);
