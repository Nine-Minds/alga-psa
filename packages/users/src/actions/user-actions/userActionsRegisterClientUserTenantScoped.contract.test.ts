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

describe('user actions register client user tenant-scoped query contract', () => {
  it('uses facade tenant joins for contact email verification discovery', () => {
    const section = sectionBetween('export async function verifyContactEmail', 'export const registerClientUser');

    expect(section).toContain(".unscoped('contacts', 'tenant discovery for client portal registration contact lookup')");
    expect(section).toContain("discoveryDb.tenantJoin(contactQuery, 'clients', 'clients.client_id', 'contacts.client_id')");
    expect(section).not.toContain(".andOn('clients.tenant', '=', 'contacts.tenant')");
  });

  it('uses structural tenant scoping for tenant-known client-role lookup', () => {
    const section = sectionBetween('export const registerClientUser', 'export const checkPasswordResetStatus');

    expect(section).toContain(".unscoped('contacts', 'tenant discovery for client portal registration contact lookup')");
    expect(section).toContain("discoveryDb.tenantJoin(contactQuery, 'clients', 'clients.client_id', 'contacts.client_id')");
    expect(section).toContain('findExistingUserByEmailGlobally(email');
    expect(section).toContain("await tenantDb(trx, contact.tenant).table('users')");
    expect(section).toContain("await tenantDb(trx, contact.tenant).table('user_roles').insert");
    expect(section).toContain(".table('roles");
    expect(section).toContain('tenant: contact.tenant');
    expect(section).toContain("whereRaw('LOWER(role_name) = ?', ['user'])");

    expect(section).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where\(\{\s*tenant: contact\.tenant,/);
    expect(section).not.toContain(".andOn('clients.tenant', '=', 'contacts.tenant')");
  });
});
