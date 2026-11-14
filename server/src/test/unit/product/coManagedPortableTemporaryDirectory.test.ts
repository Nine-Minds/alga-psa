import { afterEach, expect, it, vi } from 'vitest';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createPortableTemporaryDirectory, createPortableTemporarySweeper, PORTABLE_TEMPORARY_LIFETIME_MS } from '../../../../../packages/co-managed/src/portableTemporaryDirectory';

let root: string;
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});
// Each fixture stages under its own root and passes it explicitly. Mutating the
// process-wide TMPDIR would leak into any test file running beside this one.
async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'portable-recovery-test-'));
  return createPortableTemporarySweeper(root);
}
const stage = (kind: Parameters<typeof createPortableTemporaryDirectory>[0]) => createPortableTemporaryDirectory(kind, root);

it('reclaims expired private leases while preserving live leases and targets of contained symlinks', async () => {
  const sweeper = await fixture(), old = await stage('archive');
  const now = vi.spyOn(Date, 'now').mockReturnValue(old.expiresAt - 1);
  const live = await stage('blobs');
  const target = join(root, 'customer-original'); await writeFile(target, 'keep');
  await writeFile(join(old.directory, 'plaintext'), 'sensitive staging');
  await symlink(target, join(old.directory, 'link'));
  expect((await stat(old.directory)).mode & 0o777).toBe(0o700);
  expect((await stat(join(old.directory, '.alga-portable-lease.json'))).mode & 0o777).toBe(0o600);
  expect((await sweeper.sweep()).removed).toBe(0);
  now.mockReturnValue(old.expiresAt);
  expect(() => old.assertActive()).toThrow('expired');
  expect(() => live.assertActive()).not.toThrow();
  expect((await sweeper.sweep()).removed).toBe(1);
  expect(await readFile(target, 'utf8')).toBe('keep');
  expect(await readdir(root)).toContain(basename(live.directory));
  await old.dispose(); await live.dispose(); await sweeper.close();
});

it('preserves unmarked, linked, tampered, oversized and permissive directories', async () => {
  const sweeper = await fixture();
  const leases = await Promise.all((['archive', 'blobs', 'restore', 'remote-meetings', 'archive'] as const).map(kind =>
    stage(kind)));
  const marker = (index: number) => join(leases[index].directory, '.alga-portable-lease.json');
  await rm(marker(0));
  await rm(marker(1)); await symlink(marker(2), marker(1));
  const changed = JSON.parse(await readFile(marker(2), 'utf8')); changed.inode++;
  await writeFile(marker(2), JSON.stringify(changed));
  await writeFile(marker(3), 'x'.repeat(4097));
  await chmod(leases[4].directory, 0o755);
  const legacy = join(root, 'alga-portable-archive-legacy'); await mkdir(legacy);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + PORTABLE_TEMPORARY_LIFETIME_MS + 1);
  expect((await sweeper.sweep()).removed).toBe(0);
  expect(await readdir(root)).toHaveLength(6);
  await sweeper.close();
});

it('does not treat a copied marker as authority for a replacement directory', async () => {
  const sweeper = await fixture(), first = await stage('archive'), replacement = await stage('archive');
  await copyFile(join(first.directory, '.alga-portable-lease.json'), join(replacement.directory, '.alga-portable-lease.json'));
  vi.spyOn(Date, 'now').mockReturnValue(first.expiresAt + 1);
  expect((await sweeper.sweep()).removed).toBe(1);
  expect(await readdir(root)).toEqual([basename(replacement.directory)]);
  await sweeper.close();
});

it('resumes bounded scans past unrelated entries and safely shares overlapping sweeps', async () => {
  const sweeper = await fixture();
  for (let index = 0; index < 12; index++) await writeFile(join(root, `unrelated-${index}`), 'keep');
  const leases = await Promise.all(Array.from({ length: 5 }, () => stage('restore')));
  vi.spyOn(Date, 'now').mockReturnValue(Math.max(...leases.map(lease => lease.expiresAt)));
  let removed = 0;
  for (let index = 0; index < 9; index++) {
    const pending = sweeper.sweep(2); expect(sweeper.sweep(2)).toBe(pending);
    const result = await pending; expect(result.scanned).toBeLessThanOrEqual(2); removed += result.removed;
  }
  expect(removed).toBe(5); expect(await readdir(root)).toHaveLength(12);
  await sweeper.close();
});
