/* @vitest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'UserManagement.tsx'), 'utf8');
const localeRoot = path.resolve(__dirname, '../../../../public/locales');

describe('manual portal creation missing-role translation', () => {
  it('maps the action code to settings copy instead of the raw-English catch-all', () => {
    expect(source).toContain("useTranslation('msp/settings')");
    expect(source).toContain("PORTAL_ROLE_NOT_CONFIGURED: 'users.messages.error.portalRoleNotConfigured'");
    const genericCodes = source.match(/const GENERIC_PORTAL_INVITE_ERROR_CODES[\s\S]*?new Set\(\[([\s\S]*?)\]\)/)?.[1];
    expect(genericCodes).toBeDefined();
    expect(genericCodes).not.toContain('PORTAL_ROLE_NOT_CONFIGURED');
  });

  it('provides the missing-role message in every supported settings locale', () => {
    const english = JSON.parse(fs.readFileSync(path.join(localeRoot, 'en/msp/settings.json'), 'utf8'));
    for (const locale of ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy']) {
      const messages = JSON.parse(fs.readFileSync(path.join(localeRoot, locale, 'msp/settings.json'), 'utf8'));
      const message = messages.users.messages.error.portalRoleNotConfigured;
      expect(message, locale).toEqual(expect.any(String));
      expect(message.trim().length, locale).toBeGreaterThan(0);
      if (locale !== 'en') expect(message, locale).not.toBe(english.users.messages.error.portalRoleNotConfigured);
    }
  });
});
