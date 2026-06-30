import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'portalInvitationActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('portal invitation update-user tenant-scoped query contract', () => {
  it('uses structural tenant scoping for client-user updates', () => {
    const section = sectionFrom('export const updateClientUser');

    expect(section).toContain('tenantDb(knex, ');
    expect(section).toContain(".table('users");
    expect(section).toContain(".where({ user_id: userId, user_type: 'client' })");
    expect(section).not.toMatch(/knex\('users'\)\s*[\r\n]+\s*\.where\(\{\s*user_id: userId,\s*tenant,\s*user_type: 'client'\s*\}\)/);
  });
});
