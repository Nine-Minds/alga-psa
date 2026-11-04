import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * T029: static guard against new raw user-type binary checks.
 *
 * A raw `user_type !== 'client'` treats every non-client type as an MSP user, which is
 * exactly the "not client, so internal" bug that a non-interactive user type exposes. Use
 * the predicates in @alga-psa/types (isClientUserType, isMspPrincipalUserType,
 * isInteractiveUserType, isLicensedUserType) instead.
 */
const repoRoot = path.resolve(__dirname, '../../../..');

const PATTERNS: Array<{ name: string; regex: string }> = [
  { name: "user_type !== 'client'", regex: "user_?[tT]ype\\s*!==?\\s*['\"]client['\"]" },
  {
    name: "=== 'client' ? 'client' : 'internal'",
    regex: "[uU]ser_?[tT]ype\\??\\s*===?\\s*['\"]client['\"]\\s*\\?\\s*['\"]client['\"]\\s*:\\s*['\"]internal['\"]",
  },
  {
    name: "=== 'internal' ? 'internal' : 'client'",
    regex: "[uU]ser_?[tT]ype\\??\\s*===?\\s*['\"]internal['\"]\\s*\\?\\s*['\"]internal['\"]\\s*:\\s*['\"]client['\"]",
  },
];

// Files that legitimately define or document the vocabulary.
const ALLOWED = new Set(['packages/types/src/constants/userTypes.ts']);

function grep(regex: string): string[] {
  try {
    const out = execFileSync(
      'git',
      [
        'grep', '-nE', regex, '--',
        '*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs',
        ':!**/*.test.*', ':!**/__tests__/**', ':!**/tests/**', ':!**/test/**',
        ':!**/migrations/**', ':!**/*.d.ts', ':!**/dist/**', ':!**/node_modules/**',
        ':!**/*.generated.*',
      ],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    return out.split('\n').filter(Boolean);
  } catch (error: any) {
    if (error.status === 1) return []; // no matches
    throw error;
  }
}

describe('T029 raw user_type checks', () => {
  for (const { name, regex } of PATTERNS) {
    it(`has no non-test source containing ${name}`, () => {
      const hits = grep(regex).filter((line) => !ALLOWED.has(line.split(':')[0]));
      expect(hits).toEqual([]);
    });
  }
});
