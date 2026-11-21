import { cpSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

const serverRoot = path.resolve(__dirname, '..');

/**
 * Builds a disposable CE+EE migrations directory (EE files overlay CE
 * collisions, matching setup/entrypoint.sh and the EE integration runner).
 * Lives under server/ (gitignored `.ee-combined-migrations-*`) so
 * migration-relative helpers resolve.
 */
export function buildMergedEeMigrationsDir(): string {
  const merged = mkdtempSync(path.join(serverRoot, '.ee-combined-migrations-'));
  cpSync(path.join(serverRoot, 'migrations'), merged, { recursive: true });
  cpSync(path.join(serverRoot, '..', 'ee', 'server', 'migrations'), merged, { recursive: true, force: true });
  return merged;
}
