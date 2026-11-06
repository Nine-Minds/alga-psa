import { execFile, spawnSync } from 'node:child_process';
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

  it('accepts each restore and activation mode shape and rejects conflicts before secret input', async () => {
    const validModes = [
      { args: ['--inspect', '--archive', '/tmp/missing.alga'], phase: 'archive inspection' },
      { args: ['--apply', '--archive', '/tmp/missing.alga', '--destination-tenant', '00000000-0000-4000-8000-000000000001', '--administrator-user-id', '00000000-0000-4000-8000-000000000002'], phase: 'database connection|workspace restore' },
      { args: ['--resume', '--archive', '/tmp/missing.alga', '--destination-tenant', '00000000-0000-4000-8000-000000000001', '--administrator-user-id', '00000000-0000-4000-8000-000000000002'], phase: 'database connection|workspace restore' },
      { args: ['--activate-hosted', '--destination-tenant', '00000000-0000-4000-8000-000000000001', '--operation-id', '00000000-0000-4000-8000-000000000002'], phase: 'password input' },
      { args: ['--activate', '--destination-tenant', '00000000-0000-4000-8000-000000000001', '--operation-id', '00000000-0000-4000-8000-000000000002', '--license-file', '/tmp/missing.jwt'], phase: 'password input' },
    ];
    for (const mode of validModes) {
      const result = await documented(mode.args, { ALGA_PORTABLE_RESTORE_PASSPHRASE: PASSPHRASE });
      expect(result.err).toMatch(new RegExp(`failed during (${mode.phase})`));
      expect(result.out + result.err).not.toContain(PASSPHRASE);
    }
    const password = 'New-Administrator-Password-42!';
    const activation = spawnSync('npm', ['exec', '--', 'tsx', '--tsconfig', '../ee/server/tsconfig.json', 'scripts/restore-portable-workspace.ts',
      '--activate-hosted', '--destination-tenant', '00000000-0000-4000-8000-000000000001', '--operation-id', '00000000-0000-4000-8000-000000000002', '--password-stdin'],
    { cwd: serverDir, env: { ...process.env, FORCE_CAPABILITIES: '' }, input: password, encoding: 'utf8', timeout: 60_000 });
    expect(activation.status).not.toBe(0);
    expect(activation.stdout + activation.stderr).not.toContain(password);
    // The EE activation module must load before this credential-free fixture reaches the database boundary.
    expect(activation.stderr).toMatch(/failed during (database connection|workspace activation)/);
    const invalid = [
      ['--inspect', '--apply', '--archive', '/tmp/x.alga'],
      ['--apply', '--archive', '/tmp/x.alga'],
      ['--resume', '--archive', '/tmp/x.alga', '--destination-tenant', '00000000-0000-4000-8000-000000000001'],
      ['--activate-hosted', '--destination-tenant', '00000000-0000-4000-8000-000000000001'],
      ['--activate', '--destination-tenant', '00000000-0000-4000-8000-000000000001', '--operation-id', '00000000-0000-4000-8000-000000000002'],
      ['--apply', '--activate-hosted', '--archive', '/tmp/x.alga', '--destination-tenant', '00000000-0000-4000-8000-000000000001', '--administrator-user-id', '00000000-0000-4000-8000-000000000002', '--operation-id', '00000000-0000-4000-8000-000000000003'],
    ];
    for (const mode of invalid) {
      const result = await documented(mode, {});
      expect(result.code).not.toBe(0);
      expect(result.err).toMatch(/failed during options/);
    }
  }, 180_000);
});
