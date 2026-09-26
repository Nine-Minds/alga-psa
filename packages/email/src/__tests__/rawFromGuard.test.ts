import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(process.cwd(), '../..');
const RAW_FROM_ALLOWLIST = [
  'packages/email/src/sendCancellationRequestEmail.ts',
  'ee/server/src/app/api/billing/complete-reactivation/route.ts',
  'ee/server/src/lib/billing/reactivationInviteEmail.ts',
];
const SOURCE_ROOTS = ['packages', 'server/src', 'ee/server/src', 'shared/workflow'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__' || entry.name === 'test' || entry.name === 'tests') return [];
      return sourceFiles(fullPath);
    }
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe('tenant email raw From guard', () => {
  it('keeps tenant sendEmail call sites from specifying a raw From outside the allowlist', () => {
    const matches = SOURCE_ROOTS.flatMap((root) => sourceFiles(resolve(REPOSITORY_ROOT, root)))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(/\.sendEmail\(\s*\{[\s\S]{0,700}?\bfrom\s*:/g)]
          .map(() => relative(REPOSITORY_ROOT, file));
      })
      .filter((file) => !RAW_FROM_ALLOWLIST.includes(file));

    expect([...new Set(matches)]).toEqual([]);
  });
});
