#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const adminUser = process.env.ALGA_APPLIANCE_ADMIN_USER || 'alga-admin';
const passwordFile = process.env.ALGA_APPLIANCE_ADMIN_PASSWORD_FILE || '/var/lib/alga-appliance/admin-password';
const stateFile = process.env.ALGA_APPLIANCE_ADMIN_PASSWORD_STATE_FILE || '/var/lib/alga-appliance/admin-password-state.json';
const lockDir = process.env.ALGA_APPLIANCE_ADMIN_CREDENTIAL_LOCK_DIR || path.join(path.dirname(stateFile), 'admin-credential.lock');
const dryRun = process.env.ALGA_APPLIANCE_ADMIN_CREDENTIAL_DRY_RUN === '1';
const testDelayMs = Number(process.env.ALGA_APPLIANCE_ADMIN_CREDENTIAL_TEST_DELAY_MS || 0);

function nowIso() {
  return new Date().toISOString();
}

function generatePassword() {
  // Console-only temporary password: numeric groups are much easier to type from
  // a VM console than mixed-case/base64url while still providing ~66 bits of
  // entropy (10^20 possibilities). The user must change it on first login.
  return Array.from({ length: 5 }, () => String(crypto.randomInt(0, 10_000)).padStart(4, '0')).join('-');
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

function sleepMs(ms) {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}

function credentialAlreadyInitialized() {
  const existingState = readJson(stateFile);
  if (existingState?.status === 'configured') {
    return true;
  }

  if (existingState?.status === 'temporary' && fs.existsSync(passwordFile)) {
    return true;
  }

  return false;
}

function acquireLock() {
  fs.mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o750 });
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      return () => {
        try { fs.rmdirSync(lockDir); } catch {}
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for admin credential lock: ${lockDir}`);
      }
      sleepMs(100);
    }
  }
}

function initializeCredential() {
  if (credentialAlreadyInitialized()) {
    return;
  }

  const releaseLock = acquireLock();
  try {
    // Another systemd unit may have won the boot-time race while we waited.
    if (credentialAlreadyInitialized()) {
      return;
    }

    sleepMs(testDelayMs);

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
  } finally {
    releaseLock();
  }
}

try {
  initializeCredential();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
