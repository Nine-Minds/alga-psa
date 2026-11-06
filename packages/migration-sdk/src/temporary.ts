import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;
let lastSweep = 0;

function sweepAbandonedDirectories(now: number): void {
  if (now - lastSweep < 60 * 60 * 1000) return;
  lastSweep = now;
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
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
  sweepAbandonedDirectories(now);
  return mkdtempSync(join(tmpdir(), `amp-${kind}-${process.pid}-`));
}

// Continue TTL cleanup while a long-lived server process is running.
const cleanupTimer = setInterval(() => sweepAbandonedDirectories(Date.now()), 60 * 60 * 1000);
cleanupTimer.unref();
