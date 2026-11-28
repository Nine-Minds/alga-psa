import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

// scripts/ only forward the variable into compose env (they do not decide anything).
// EMAIL_ENABLE is an off switch resolved in exactly one place. The fingerprint
// hashes the raw value so a flag change rotates the cached provider.
const ALLOWED = new Set([
  'packages/email/src/system/systemEmailState.ts',
  'packages/email/src/system/SystemEmailProviderFactory.ts', // getConfigFingerprint only
]);

describe('EMAIL_ENABLE source guard', () => {
  it('reads process.env.EMAIL_ENABLE only in the resolver and getConfigFingerprint', () => {
    let out = '';
    try {
      out = execFileSync(
        'git',
        ['grep', '-n', 'process\\.env\\.EMAIL_ENABLE\\b', '--', '*.ts', '*.tsx', '*.js', '*.mjs', ':!*.test.*', ':!**/__tests__/**', ':!**/test/**', ':!scripts/**'],
        { cwd: repoRoot, encoding: 'utf8' },
      );
    } catch (error: any) {
      if (error.status !== 1) throw error; // 1 = no matches
    }
    const hits = out.split('\n').filter(Boolean).map((line) => {
      const [file, lineNo, ...rest] = line.split(':');
      return { file, lineNo, text: rest.join(':') };
    });
    const offenders = hits.filter((h) => !ALLOWED.has(h.file));
    expect(offenders).toEqual([]);

    const factoryHits = hits.filter((h) => h.file === 'packages/email/src/system/SystemEmailProviderFactory.ts');
    expect(factoryHits).toHaveLength(1);
    expect(factoryHits[0].text).toContain('emailEnable');
  });
});
