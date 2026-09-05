import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The password-change actions report failure as `{ success: false, error }` rather
 * than as an `actionError` payload, so they localize through the same `withAuth`
 * boundary only if every failing branch carries a `messageKey`. One that does not
 * renders English on an otherwise translated page, which is exactly how
 * "Current password is incorrect" survived on a German `/msp/profile`.
 */
const actionsPath = resolve(__dirname, 'userActions.ts');
const source = readFileSync(actionsPath, 'utf8');

const LOCALES_DIR = resolve(__dirname, '../../../../../server/public/locales');
const REAL_LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt'] as const;

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

/** Resolves `'common:errors.password.currentIncorrect'` against one locale's pack. */
function lookup(locale: string, namespacedKey: string): unknown {
  const separator = namespacedKey.lastIndexOf(':');
  const namespace = namespacedKey.slice(0, separator);
  const keyPath = namespacedKey.slice(separator + 1);

  const pack = JSON.parse(
    readFileSync(resolve(LOCALES_DIR, locale, `${namespace}.json`), 'utf8'),
  );

  return keyPath.split('.').reduce<unknown>(
    (node, segment) =>
      node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined,
    pack,
  );
}

const PASSWORD_SECTIONS = {
  changeOwnPassword: sectionBetween(
    'export const changeOwnPassword = withAuth',
    '// Function for admins to change user passwords',
  ),
  adminChangeUserPassword: sectionBetween(
    'export const adminChangeUserPassword = withAuth',
    'Uploads or replaces a user',
  ),
};

describe('password-change action localization contract', () => {
  it.each(Object.entries(PASSWORD_SECTIONS))(
    '%s attaches a messageKey to every failure return',
    (_name, section) => {
      const failures = section.match(/success:\s*false/g) ?? [];
      const keys = section.match(/messageKey:\s*'[^']+'/g) ?? [];

      expect(failures.length).toBeGreaterThan(0);
      expect(keys).toHaveLength(failures.length);
    },
  );

  it('names the incorrect-current-password key the profile form renders', () => {
    expect(PASSWORD_SECTIONS.changeOwnPassword).toContain(
      "messageKey: 'common:errors.password.currentIncorrect'",
    );
  });

  it.each(REAL_LOCALES)('resolves every password messageKey in %s', (locale) => {
    const keys = Object.values(PASSWORD_SECTIONS)
      .flatMap((section) => section.match(/messageKey:\s*'([^']+)'/g) ?? [])
      .map((match) => match.replace(/^messageKey:\s*'/, '').replace(/'$/, ''));

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      const value = lookup(locale, key);
      expect(typeof value, `${key} missing from ${locale}`).toBe('string');
      expect(value, `${key} empty in ${locale}`).not.toBe('');
    }
  });

  it('does not translate the same English sentence twice under different keys', () => {
    const passwordBlock = JSON.parse(
      readFileSync(resolve(LOCALES_DIR, 'en', 'common.json'), 'utf8'),
    ).errors.password as Record<string, string>;

    const values = Object.values(passwordBlock);
    expect(new Set(values).size).toBe(values.length);
  });
});
