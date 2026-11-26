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
    // the email states cannot drift apart, and it leaves a trace of its own.
    expect(transactionalCreate).toContain('expires_at: expiresAt,');
    expect(transactionalCreate).toContain('last_sent_at: new Date().toISOString(),');
    expect(transactionalCreate).not.toContain("interval '24 hours'");
  });

  it('only renews a link going to the same delivery mailbox', () => {
    // Renewing a row whose stored address the contact lost would re-arm the
    // token in a stranger's mailbox for the tenant's whole validity, every time
    // the MSP resends. Any different delivery mailbox gets a new token,
    // even while the old one remains additional, preserving provenance.
    const transactionalCreate = sectionBetween(
      'static async createInvitationWithTransaction',
      'static async verifyToken'
    );

    expect(transactionalCreate).toContain(
      'if (invitationAddressBelongsToContact(existingInvitation.email, [contact.email])) {'
    );
    expect(transactionalCreate).toContain(".orderBy('created_at', 'desc')");
    expect(transactionalCreate).toContain(".orderBy('invitation_id', 'desc')");
    expect(transactionalCreate).toContain('.forUpdate()');
    expect(transactionalCreate).toContain("revoked_reason: 'email_changed'");
    expect(transactionalCreate).toContain('used_at: trx.fn.now(),');

    // The address set is read tenant-scoped, like everything else here.
    const addressRead = sectionBetween(
      'static async resolveContactAddresses',
      'static async createInvitationWithTransaction'
    );
    expect(addressRead).toContain("tenantDb(db, tenant).table('contact_additional_email_addresses')");
    expect(addressRead).not.toMatch(/\bdb\('contact_additional_email_addresses'\)/);
  });

  it('judges the address at use time by the same rule the MSP\'s screens use', () => {
    const section = sectionBetween('static async verifyToken', 'static async markTokenAsUsed');

    expect(section).toContain('invitationRefusedAtUseTime({');
    expect(section).toContain('contactEmails: contactAddresses');
    // The old single-address predicate refused a link sitting in an address the
    // MSP kept on the contact, which inbound email still matches to them.
    expect(section).not.toContain('lower(btrim(c.email)) = lower(btrim(pi.email))');
  });

  it('reaches the contact\'s addresses from the token\'s own row, not with a second read', () => {
    // Verifying a token is unauthenticated: the token is the only credential,
    // so there is no authorization entry point to put in front of it, and the
    // read-authorization contract (server/src/test/unit/product/
    // readAuthorizationCoverage.contract.test.ts) will not let this path grow a
    // standalone read of a client-owned table. Every client-owned row it needs
    // therefore hangs off the invitation row the token found, tenant-scoped
    // through tenantJoin — the contact and its client always did, and the
    // additional addresses now do too, narrowed in the join to the one address
    // that could be the same mailbox so no aggregation is needed.
    const section = sectionBetween('static async verifyToken', 'static async markTokenAsUsed');

    expect(section).toMatch(
      /scopedDb\.tenantJoin\(\s*invitationQuery,\s*'contact_additional_email_addresses as cea',/
    );
    expect(section).toContain("'cea.email_address as matched_additional_email'");
    expect(section).toContain(
      'const contactAddresses = [invitation.contact_email, invitation.matched_additional_email ?? null];'
    );
    // The join's notion of "the same mailbox" is the one the JS rule and the
    // contact list's state SQL apply, from one helper.
    expect(section).toContain("normalizedInvitationAddressSql('cea.email_address')");
    expect(section).toContain("normalizedInvitationAddressSql('pi.email')");
    // No standalone read of the contact's tables from the token path.
    expect(section).not.toContain('this.resolveContactAddresses(');
    expect(section).not.toContain(".table('contact_additional_email_addresses");
    expect(section).not.toContain(".table('contacts");
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

  it('carries the contact\'s own standing on every history row', () => {
    // The reader of the history applies the same refusals verifyToken applies
    // (a deactivated contact, an address the contact no longer has), so the
    // contact's current address and active flag travel with each row — joined
    // tenant-scoped, like every other join in this service.
    const section = sectionBetween('static async getInvitationHistory', 'static async revokeInvitation');

    expect(section).toContain("tenantDb(knex, tenant)");
    expect(section).toContain(".table('portal_invitations as pi')");
    expect(section).toContain("scopedDb.tenantJoin(query, 'contacts as c', 'pi.contact_id', 'c.contact_name_id'");
    expect(section).toContain("'c.email as contact_email'");
    expect(section).toContain('coalesce(c.is_inactive, false) as contact_inactive');
    // Every address the contact can receive at, not just the primary one: the
    // history has to reach verifyToken's verdict about the very same link.
    expect(section).toContain('contact_emails: contactAddresses');
    expect(section).not.toMatch(/knex\('contacts'\)/);
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
