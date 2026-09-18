import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * `--state-file` snapshot/restore.
 *
 * Emulator state was in-memory only, so every container restart wiped the
 * seeded clients, users, meetings and calls — by far the biggest source of
 * friction during the Teams work, because re-seeding also meant re-running the
 * app-side setup that consumed those seeds.
 *
 * The snapshot is a plain JSON document written after each mutating control
 * call (debounced) and on shutdown. Cores opt in by implementing
 * `snapshot()`/`restore()`; a core without them simply does not persist.
 */

export interface SnapshotCapableCore {
  snapshot?(): unknown;
  restore?(state: unknown): void;
}

export interface HostSnapshot {
  version: 1;
  savedAt: string;
  clockOffsetMs: number;
  emulators: Record<string, unknown>;
}

export function readSnapshot(path: string): HostSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HostSnapshot;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    // A missing or unreadable state file is the normal first-boot case.
    return null;
  }
}

export function writeSnapshot(path: string, snapshot: HostSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/**
 * Coalesces bursts of mutations into one write. Seeding a scenario fires dozens
 * of control calls; persisting each one would turn the state file into the
 * bottleneck.
 */
export class DebouncedSnapshotWriter {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly path: string,
    private readonly build: () => HostSnapshot,
    private readonly delayMs = 250,
  ) {}

  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.delayMs);
    // Never hold the process open just to write a dev-time snapshot.
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeSnapshot(this.path, this.build());
  }
}
