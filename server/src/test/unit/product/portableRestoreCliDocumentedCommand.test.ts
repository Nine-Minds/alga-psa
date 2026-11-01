import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { sealPortableArchive } from '../../../../../packages/co-managed/src/portableArchive';
import { fixtureManifest, PACKAGE, SOURCE } from './portableRestoreFixtures';

const run = promisify(execFile);
const PASSPHRASE = 'correct horse battery staple';
const serverDir = resolve(__dirname, '../../../..');
const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** The exact command the CLI's --help documents, run from server/. */
const documented = (args: string[], env: Record<string, string>) =>
  run('npm', ['exec', '--', 'tsx', '--tsconfig', '../ee/server/tsconfig.json', 'scripts/restore-portable-workspace.ts', ...args],
    { cwd: serverDir, env: { ...process.env, FORCE_CAPABILITIES: '', ...env } })
    .then(r => ({ code: 0, out: r.stdout, err: r.stderr }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout, err: e.stderr }));

describe('documented restore command (tsx with the EE tsconfig)', () => {
  it('loads the EE modules and inspects a real archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alga-l7b2-cli-')); roots.push(root);
    const { manifest, context, files } = await fixtureManifest();
    const sealed = await sealPortableArchive({ context: { packageId: context.packageId, sourceTenant: context.sourceTenant }, manifest: manifest as never, files, stagingRoot: root }, PASSPHRASE);
    const result = await documented(['--inspect', '--archive', sealed.path], { ALGA_PORTABLE_RESTORE_PASSPHRASE: PASSPHRASE });
    await sealed.dispose();
    expect(result.err).not.toContain('failed during');
    expect(result.code).toBe(0);
    const inspected = JSON.parse(result.out);
    expect(inspected).toMatchObject({ sourceTenant: SOURCE, packageId: PACKAGE });
    expect(inspected.administrators).toHaveLength(1);
  }, 180_000);

  it('still prints help, rejects a passphrase argument and honours the kill switch before secret input', async () => {
    expect((await documented(['--help'], {})).code).toBe(0);
    const rejected = await documented(['--inspect', '--archive', '/tmp/x.alga', '--passphrase=hunter2-hunter2-hunter2'], {});
    expect(rejected.code).not.toBe(0); expect(rejected.out + rejected.err).not.toContain('hunter2');
    const off = await documented(['--inspect', '--archive', '/tmp/x.alga'], { FORCE_CAPABILITIES: 'co-managed:off', ALGA_PORTABLE_RESTORE_PASSPHRASE: 'never-read-this-passphrase' });
    expect(off.code).not.toBe(0); expect(off.err).toContain('failed during environment'); expect(off.out + off.err).not.toContain('never-read');
  }, 180_000);
});
