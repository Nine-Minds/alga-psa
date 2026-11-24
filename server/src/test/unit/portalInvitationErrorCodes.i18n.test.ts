/**
 * Every portal-invitation refusal the MSP or the invited contact can run into
 * has to arrive in their own language.
 *
 * Two surfaces answer for that: the portal setup page maps the whole
 * `PortalInvitationErrorCode` union (a total Record, so a new code breaks the
 * build until it is translated), and the contact's Portal tab maps each code
 * its own send/revoke path can emit. A code with no key falls through to the
 * English `error` string the server attached, which is what a German MSP would
 * then read on a German screen.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '../../../..');
const localesDir = join(repo, 'server/public/locales');
const locales = readdirSync(localesDir).filter((dir) => existsSync(join(localesDir, dir, 'client-portal.json')));

const read = (rel: string) => readFileSync(join(repo, rel), 'utf8');

/** The union, as the type declares it. Doc comments carry prose semicolons. */
function errorCodes(): string[] {
  const source = read('packages/portal-shared/src/types/index.ts').replace(/\/\*[\s\S]*?\*\//g, '');
  const union = source.slice(
    source.indexOf('export type PortalInvitationErrorCode ='),
    source.indexOf(';', source.indexOf('export type PortalInvitationErrorCode =')),
  );
  return [...new Set([...union.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]))];
}

/** The `CODE: 'some.translation.key'` pairs of one mapping object. */
function mappedKeys(rel: string, constName: string): Map<string, string> {
  const source = read(rel);
  const start = source.indexOf(`const ${constName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = source.slice(start, source.indexOf('};', start));
  return new Map([...body.matchAll(/([A-Z_]+):\s*'([A-Za-z0-9_.]+)'/g)].map((match) => [match[1], match[2]]));
}

function lookup(json: unknown, key: string): unknown {
  return key.split('.').reduce<any>(
    (current, segment) => (current && typeof current === 'object' ? current[segment] : undefined),
    json,
  );
}

const codes = errorCodes();

describe('portal invitation error codes are translated', () => {
  it('reads the union off the type', () => {
    expect(codes).toContain('INVALID_OR_EXPIRED_TOKEN');
    expect(codes.length).toBeGreaterThanOrEqual(25);
    expect(locales.length).toBeGreaterThanOrEqual(9);
  });

  describe('portal setup page (client-portal namespace)', () => {
    const mapped = mappedKeys('server/src/app/auth/portal/setup/page.tsx', 'PORTAL_ERROR_CODE_KEYS');

    it('maps every code in the union', () => {
      // The map is typed Record<PortalInvitationErrorCode, string>, so a code
      // added without a message here fails the app typecheck.
      expect([...codes].sort().filter((code) => !mapped.has(code))).toEqual([]);
    });

    for (const locale of locales) {
      it(`has every mapped message in ${locale}`, () => {
        const messages = JSON.parse(readFileSync(join(localesDir, locale, 'client-portal.json'), 'utf8'));
        const missing = [...mapped.values()].filter((key) => typeof lookup(messages, key) !== 'string');
        expect(missing).toEqual([]);
      });
    }
  });

  describe('contact portal tab (msp/contacts namespace)', () => {
    const tab = 'packages/clients/src/components/contacts/ContactPortalTab.tsx';
    const mapped = mappedKeys(tab, 'PORTAL_INVITE_ERROR_KEYS');

    it('maps every code its own send and revoke paths can refuse with', () => {
      // Codes raised per contact by sendPortalInvitation / revokePortalInvitation
      // — the two calls this tab makes. A missing one shows the server's English
      // sentence on a translated screen.
      const perContactCodes = [
        'PERMISSION_DENIED_INVITE',
        'EMAIL_NOT_CONFIGURED',
        'CONTACT_NOT_FOUND',
        'CONTACT_MISSING_EMAIL',
        'CONTACT_INVALID_EMAIL',
        'CONTACT_INACTIVE',
        'USER_EXISTS_FOR_CONTACT',
        'PORTAL_USER_ALREADY_EXISTS',
        'BASE_URL_NOT_CONFIGURED',
        'INVITATION_NOT_FOUND',
        'RATE_LIMITED',
      ];
      expect(perContactCodes.filter((code) => !mapped.has(code))).toEqual([]);
      // And each of those is a real code, not a stale name.
      expect(perContactCodes.filter((code) => !codes.includes(code))).toEqual([]);
    });

    for (const locale of locales) {
      it(`has every mapped message in ${locale}`, () => {
        const messages = JSON.parse(readFileSync(join(localesDir, locale, 'msp/contacts.json'), 'utf8'));
        const missing = [...mapped.values()].filter((key) => typeof lookup(messages, key) !== 'string');
        expect(missing).toEqual([]);
      });
    }
  });
});
