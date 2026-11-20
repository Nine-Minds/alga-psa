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
    // One create path: the non-transactional twin had no callers and is gone.
    const transactionalCreate = sectionBetween(
      'static async createInvitationWithTransaction',
      'static async verifyToken'
    );

    expect(source).not.toContain('static async createInvitation(contactId');
    expect(transactionalCreate).toContain('tenantDb(trx, ');
    expect(transactionalCreate).toContain(".table('contacts");
    expect(transactionalCreate).toContain(".table('portal_invitations");

    expect(transactionalCreate).not.toMatch(/trx\('contacts'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(transactionalCreate).not.toMatch(/trx\('portal_invitations'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });

  it('computes the expiry in the database from the tenant\'s validity, on create and on resend', () => {
    const transactionalCreate = sectionBetween(
      'static async createInvitationWithTransaction',
      'static async verifyToken'
    );

    expect(transactionalCreate).toContain("trx.raw('now() + make_interval(days => ?)', [validityDays])");
    // The resend renews the row it reuses, so the stored expiry and the period
    // the email states cannot drift apart.
    expect(transactionalCreate).toContain('.update({ expires_at: expiresAt });');
    expect(transactionalCreate).not.toContain("interval '24 hours'");
  });

  it('keeps expired invitations until the retention floor instead of deleting them on sight', () => {
    expect(source).toContain('const PORTAL_INVITATION_RETENTION_DAYS = 90;');
    const deletes = source.match(
      /\.where\('expires_at', '<', [\s\S]{0,120}?\)\s*[\r\n]+\s*\.del\(\)/g
    ) ?? [];
    expect(deletes).toHaveLength(2);
    for (const predicate of deletes) {
      expect(predicate).toContain("now() - make_interval(days => ?)', [PORTAL_INVITATION_RETENTION_DAYS]");
    }
  });

  it('keeps token tenant discovery explicit and scopes tenant-known token work structurally', () => {
    const section = sectionBetween('static async verifyToken', 'static async markTokenAsUsed');

    expect(section).toContain('const tokenInfo = await tenantDb(trx, PORTAL_INVITATION_TENANT_DISCOVERY)');
    expect(section).toContain(".unscoped('portal_invitations', 'tenant discovery from portal invitation token')");
    expect(section).toContain("tenantDb(trx, tokenTenant).table('portal_invitations");
    expect(section).toContain(".table('portal_invitations as pi");
    expect(section).not.toContain(".where('pi.tenant', tokenTenant)");
  });

  it('uses structural tenant scoping for invitation update and cleanup roots', () => {
    const section = sectionFrom('static async markTokenAsUsed');

    expect(section).toContain('tenantDb(trx, ');
    expect(section).toContain('tenantDb(knex, ');
    expect(section).toContain('tenantDb(tx, ');
    expect(section).toContain(".table('portal_invitations");
    expect(section).toContain("tenantDb(tx, tenant).table('audit_logs').insert({");
    expect(section).toContain("tenant: tenant || '00000000-0000-0000-0000-000000000000'");

    expect(section).not.toMatch(/trx\('portal_invitations'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/knex\('portal_invitations'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/tx\('portal_invitations'\)\s*[\r\n]+\s*\.where\('tenant', tenant\)/);
    expect(section).not.toMatch(/\b(?:tx|trx|knex)\('audit_logs'\)/);
    expect(section).not.toMatch(/\b(?:tx|trx|knex)\.raw\(\s*['"`][^'"`]*\baudit_logs\b/i);
  });
});
