import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertFreshPortableRestoreInstallation } from '../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestore';

const run = promisify(execFile);
const fakeDb = (row: Record<string, boolean>) => ({ raw: async () => ({ rows: [row] }) }) as never;

describe('installation freshness', () => {
  it('accepts an installation with no co-managed relationship, entitlement or foreign receipt', async () => {
    await expect(assertFreshPortableRestoreInstallation(fakeDb({ relationships: false, entitlements: false, receipts: false }), 'x')).resolves.toBeUndefined();
  });
  for (const held of ['relationships', 'entitlements', 'receipts']) {
    it(`refuses an installation that already holds ${held}`, async () => {
      await expect(assertFreshPortableRestoreInstallation(fakeDb({ relationships: false, entitlements: false, receipts: false, [held]: true }), 'x')).rejects.toThrow('already holds');
    });
  }
});

describe('operator CLI argument handling', () => {
  const script = resolve(__dirname, '../../../../scripts/restore-portable-workspace.ts');
  const cli = (...args: string[]) => run('npx', ['tsx', script, ...args], { cwd: resolve(__dirname, '../../../..'), env: { ...process.env, FORCE_CAPABILITIES: '' } })
    .then(r => ({ code: 0, out: r.stdout + r.stderr }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }));
  it('rejects a passphrase passed as an argument without echoing it', async () => {
    const result = await cli('--inspect', '--archive', '/tmp/x.alga', '--passphrase=hunter2-hunter2-hunter2');
    expect(result.code).not.toBe(0); expect(result.out).not.toContain('hunter2');
  }, 120_000);
  it('prints help without connecting to the database', async () => {
    const result = await cli('--help'); expect(result.code).toBe(0); expect(result.out).toContain('--resume');
  }, 120_000);
  it('is disabled by FORCE_CAPABILITIES=co-managed:off before reading any secret', async () => {
    const result = await run('npx', ['tsx', script, '--inspect', '--archive', '/tmp/x.alga'], { cwd: resolve(__dirname, '../../../..'),
      env: { ...process.env, FORCE_CAPABILITIES: 'co-managed:off', ALGA_PORTABLE_RESTORE_PASSPHRASE: 'never-read-this-passphrase' } })
      .then(r => ({ code: 0, out: r.stdout + r.stderr }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }));
    expect(result.code).not.toBe(0); expect(result.out).toContain('failed during environment'); expect(result.out).not.toContain('never-read');
  }, 120_000);
});
