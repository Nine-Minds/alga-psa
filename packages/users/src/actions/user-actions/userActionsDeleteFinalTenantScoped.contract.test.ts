import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'userActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user actions delete final tenant-scoped query contract', () => {
  it('uses structural tenant scoping for EE-only cleanup and final user delete', () => {
    const section = sectionBetween('// ── EE-only tables', 'revalidatePath');

    expect(section).toContain("await tenantScopedTable('platform_notification_recipients')");
    expect(section).toContain("await tenantScopedTable('user_auth_accounts')");
    expect(section).toContain("await tenantScopedTable('chats')");
    expect(section).toContain("const deleted = await tenantScopedTable('users').where({ user_id: userId }).del()");

    expect(section).not.toMatch(/trx\('(platform_notification_recipients|user_auth_accounts|chats)'\)\s*[\r\n]+\s*\.where\(\{\s*user_id: userId,\s*tenant: tenantOrUndef\s*\}\)/);
    expect(section).not.toMatch(/trx\('users'\)\.where\(\{\s*user_id: userId,\s*tenant: tenantOrUndef\s*\}\)\.del\(\)/);
    expect(section).not.toContain('tenantOrUndef');
  });
});
