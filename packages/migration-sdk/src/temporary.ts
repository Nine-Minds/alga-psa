import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;
let lastSweep = 0;

/** Private local staging with bounded recovery of abandoned SDK workspaces. */
export function createAmpTemporaryDirectory(kind: 'reader' | 'package'): string {
  const now = Date.now();
  if (now - lastSweep > 60 * 60 * 1000) {
    lastSweep = now;
    for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
      const match = /^amp-(?:reader|package)-(\d+)-[A-Za-z0-9_-]+$/.exec(entry.name);
      if (!match || !entry.isDirectory()) continue;
      const candidate = join(tmpdir(), entry.name);
      try {
        if (now - statSync(candidate).mtimeMs <= ABANDONED_AFTER_MS) continue;
        const pid = Number(match[1]);
        let active = true;
        try { process.kill(pid, 0); } catch (error) { active = (error as NodeJS.ErrnoException).code === 'EPERM'; }
        if (!active) rmSync(candidate, { recursive: true, force: true });
      } catch { /* Concurrent cleanup or inaccessible entries are left alone. */ }
    }
  }
  return mkdtempSync(join(tmpdir(), `amp-${kind}-${process.pid}-`));
}
