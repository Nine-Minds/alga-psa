import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, 'PortalInvitationService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('portal invitation service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for invitation creation reads', () => {
    const transactionalCreate = sectionBetween(
      'static async createInvitationWithTransaction',
      'static async createInvitation(contactId'
    );
    const directCreate = sectionBetween(
      'static async createInvitation(contactId',
      'static async verifyToken'
    );

    expect(transactionalCreate).toContain('createTenantScopedQuery(trx, {');
    expect(transactionalCreate).toContain("table: 'contacts'");
    expect(transactionalCreate).toContain("table: 'portal_invitations'");
    expect(directCreate).toContain('createTenantScopedQuery(knex, {');
    expect(directCreate).toContain("table: 'contacts'");
    expect(directCreate).toContain("table: 'portal_invitations'");

    expect(transactionalCreate).not.toMatch(/trx\('contacts'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(transactionalCreate).not.toMatch(/trx\('portal_invitations'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(directCreate).not.toMatch(/knex\('contacts'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(directCreate).not.toMatch(/knex\('portal_invitations'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });

  it('keeps token tenant discovery explicit and scopes tenant-known token work structurally', () => {
    const section = sectionBetween('static async verifyToken', 'static async markTokenAsUsed');

    expect(section).toContain("const tokenInfo = await trx('portal_invitations')");
    expect(section).toContain('tenant: tokenTenant');
    expect(section).toContain("table: 'portal_invitations as pi'");
    expect(section).not.toContain(".where('pi.tenant', tokenTenant)");
  });

  it('uses structural tenant scoping for invitation update and cleanup roots', () => {
    const section = sectionFrom('static async markTokenAsUsed');

    expect(section).toContain('createTenantScopedQuery(trx, {');
    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain('createTenantScopedQuery(tx, {');
    expect(section).toContain("table: 'portal_invitations'");

    expect(section).not.toMatch(/trx\('portal_invitations'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/knex\('portal_invitations'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/tx\('portal_invitations'\)\s*[\r\n]+\s*\.where\('tenant', tenant\)/);
  });
});
