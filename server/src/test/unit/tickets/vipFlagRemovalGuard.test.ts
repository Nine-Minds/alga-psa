import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T026: VIP / point-of-contact are tags plus display rules, never columns or filter keys.
 * Whole-word matches only, so unrelated fixtures such as `fixture_is_vip` do not trip it.
 * Scans product source only: test files/directories are excluded (negative tests and
 * fixtures may name the removed keys), as is ticketFilterMigration.ts, which lists the
 * removed keys on purpose so it can strip them from saved filters.
 */
const repoRoot = path.resolve(__dirname, '../../../../..');

const EXCLUDES = [
  ':!ee/docs',
  ':!server/.next-review',
  ':!packages/list-views/src/lib/ticketFilterMigration.ts',
  ':(glob,exclude)**/*.test.*',
  ':(glob,exclude)**/*.spec.*',
  ':(glob,exclude)**/test/**',
  ':(glob,exclude)**/tests/**',
  ':(glob,exclude)**/__tests__/**',
  ':(glob,exclude)**/e2e/**',
];

describe('VIP / POC flag removal guard', () => {
  it('finds no flag references outside plan docs', () => {
    const pattern =
      'is_vip|is_primary_contact|requester_vip|client_vip|requesterVip|clientVip|contact_is_vip|contact_is_primary_contact|client_is_vip|requesterVipOnly';
    let output = '';
    try {
      output = execFileSync(
        'git',
        ['grep', '-nwE', pattern, '--', '.', ...EXCLUDES],
        { cwd: repoRoot, encoding: 'utf8' },
      );
    } catch (error: any) {
      if (error.status !== 1) throw error; // 1 = no matches
    }
    expect(output.trim()).toBe('');
  });

  it('keeps the flag migration deleted', () => {
    expect(existsSync(path.join(repoRoot, 'server/migrations/20261022120000_add_vip_and_primary_contact_flags.cjs'))).toBe(false);
  });
});
