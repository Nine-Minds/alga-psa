import { mkdtempSync, readdirSync, rmSync, statSync, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;
let lastSweep = 0;

export function sweepAmpTemporaryDirectories(
  now = Date.now(),
  enumerate: () => Dirent[] = () => readdirSync(tmpdir(), { withFileTypes: true })
): void {
  if (now - lastSweep < 60 * 60 * 1000) return;
  lastSweep = now;
  let entries;
  try { entries = enumerate(); }
  catch { return; /* Temporary storage may be unavailable during a sweep. */ }
  for (const entry of entries) {
    if (!/^amp-(?:reader|package)-\d+-[A-Za-z0-9_-]+$/.test(entry.name) || !entry.isDirectory()) continue;
    const candidate = join(tmpdir(), entry.name);
    try {
      if (now - statSync(candidate).mtimeMs > ABANDONED_AFTER_MS) rmSync(candidate, { recursive: true, force: true });
    } catch { /* Concurrent cleanup or inaccessible entries are left alone. */ }
  }
}

/** Private local staging with bounded recovery of abandoned SDK workspaces. */
export function createAmpTemporaryDirectory(kind: 'reader' | 'package'): string {
  const now = Date.now();
  sweepAmpTemporaryDirectories(now);
  return mkdtempSync(join(tmpdir(), `amp-${kind}-${process.pid}-`));
}

// Continue TTL cleanup while a long-lived server process is running.
const cleanupTimer = setInterval(() => sweepAmpTemporaryDirectories(Date.now()), 60 * 60 * 1000);
cleanupTimer.unref();
