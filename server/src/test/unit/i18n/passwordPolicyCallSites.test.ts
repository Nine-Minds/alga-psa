import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePassword } from '@alga-psa/validation';

/**
 * `validatePassword` returns English unless a translator is handed to it, so a
 * call site that renders its return value without one prints English on an
 * otherwise translated page. The checklist drawn next to the field only covers
 * length and character classes; the common-word blocklist and the long-sequence
 * rule fire *past* that checklist, which is why the untranslated branch stayed
 * invisible — `Password1!` ticks every box on screen and is then rejected by the
 * blocklist.
 *
 * Pinned by source rather than by rendering each form: the defect is a missing
 * argument, and observing it through the UI would mean reproducing five
 * different page shells.
 */

const repoRoot = path.resolve(__dirname, '../../../../..');

/**
 * Every module that calls the shared password policy. A new consumer belongs in
 * this list — that is the point of the test.
 */
const CONSUMERS = [
  'packages/auth/src/components/RegisterForm.tsx',
  'packages/users/src/actions/user-actions/userInvitationActions.ts',
  'packages/users/src/components/settings/PasswordChangeForm.tsx',
  'packages/validation/src/lib/schemas/index.ts',
  'server/src/app/auth/portal/setup/page.tsx',
  'server/src/app/auth/team/setup/page.tsx',
  'server/src/app/auth/password-reset/set-new-password/SetNewPasswordClient.tsx',
];

/**
 * `passwordSchema` is the server-side Zod gate. It runs with no request context
 * and no translator, and its message is re-keyed at the action boundary, so
 * English here is deliberate rather than an oversight.
 */
const ENGLISH_BY_DESIGN = new Set(['packages/validation/src/lib/schemas/index.ts']);

const IMPORT = /import\s*\{([^}]*)\}\s*from\s*'(?:@alga-psa\/validation|\.\.\/passwordValidation)'/;

/**
 * The local name the policy validator is bound to in this file. Several files
 * alias it to `validatePasswordPolicy` to keep it apart from their own
 * `validatePassword` checklist helper, and matching the wrong one would pin
 * calls that never touch the shared policy.
 */
function localName(source: string): string | null {
  const specifiers = source.match(IMPORT)?.[1];
  const bound = specifiers?.match(/\bvalidatePassword\b(?:\s+as\s+(\w+))?/);

  return bound ? (bound[1] ?? 'validatePassword') : null;
}

/** Reads the argument list of a call, tolerating nested and multi-line arguments. */
function argumentsAt(source: string, openParen: number): string {
  let depth = 0;

  for (let i = openParen; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }

  return source.slice(openParen + 1);
}

interface CallSite {
  file: string;
  line: number;
  text: string;
  /** True when the result is bound to a variable, i.e. kept in order to be shown. */
  bound: boolean;
  translated: boolean;
}

function callSites(relativePath: string): CallSite[] {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const name = localName(source);
  if (!name) return [];

  const sites: CallSite[] = [];
  const call = new RegExp(`\\b${name}\\s*\\(`, 'g');

  for (const match of source.matchAll(call)) {
    const start = match.index!;
    // Skip the import specifier itself, which never carries a call.
    if (source.lastIndexOf('import', start) > source.lastIndexOf('\n', start)) continue;

    const lineStart = source.lastIndexOf('\n', start) + 1;
    const args = argumentsAt(source, start + match[0].length - 1);

    sites.push({
      file: relativePath,
      line: source.slice(0, start).split('\n').length,
      text: source.slice(lineStart, source.indexOf('\n', start)).trim(),
      bound: new RegExp(`(?:const|let|var)\\s+\\w+\\s*=\\s*$`).test(source.slice(lineStart, start)),
      translated: args.includes(','),
    });
  }

  return sites;
}

const allCallSites = CONSUMERS.flatMap(callSites);

describe('password policy call sites', () => {
  it('finds the call sites it means to guard', () => {
    // A rename or a dropped import would otherwise let this file pass vacuously.
    for (const consumer of CONSUMERS) {
      expect(
        allCallSites.some((site) => site.file === consumer),
        `no password-policy call found in ${consumer}`,
      ).toBe(true);
    }
  });

  it('passes a translator wherever the message is rendered', () => {
    const untranslated = allCallSites.filter(
      (site) => site.bound && !site.translated && !ENGLISH_BY_DESIGN.has(site.file),
    );

    expect(
      untranslated.map((site) => `${site.file}:${site.line} — ${site.text}`),
      'these call sites render password-policy output without a translator',
    ).toEqual([]);
  });

  it('leaves the boolean predicate uses alone', () => {
    // `validatePasswordPolicy(pw) === null` and the bare truthiness guard on the
    // submit button never render the string, so requiring a translator there
    // would be noise. Pinned so a later sweep does not churn them.
    const predicates = allCallSites.filter((site) => !site.bound);

    expect(predicates.length).toBeGreaterThan(0);
    for (const site of predicates) {
      expect(site.translated, `${site.file}:${site.line} passes an unused translator`).toBe(false);
    }
  });
});

describe('the branch the checklist hides', () => {
  /** Resolves `common:auth.validation.password.*` against a real locale pack. */
  function translatorFor(locale: string) {
    const pack = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'server/public/locales', locale, 'common.json'), 'utf8'),
    );

    return (key: string, options?: Record<string, unknown>): string => {
      const resolved = key
        .slice(key.lastIndexOf(':') + 1)
        .split('.')
        .reduce<unknown>(
          (node, segment) =>
            node && typeof node === 'object'
              ? (node as Record<string, unknown>)[segment]
              : undefined,
          pack,
        );

      return typeof resolved === 'string' ? resolved : String(options?.defaultValue ?? '');
    };
  }

  const de = translatorFor('de');

  it('translates the common-word rejection a German user actually hits', () => {
    // `Password1!` satisfies every requirement drawn on screen, so this is the
    // first message such a user sees — and it was the one still in English.
    const message = validatePassword('Password1!', de);

    expect(message).toBe(
      'Das Passwort ist zu gebräuchlich. Bitte wählen Sie ein stärkeres Passwort',
    );
    expect(message).not.toBe(validatePassword('Password1!'));
  });

  it('translates the sequential-run rejection too', () => {
    const message = validatePassword('Abcdefg1!', de);

    expect(message).toBe('Das Passwort darf keine zusammenhängende Zeichenfolge enthalten');
    expect(message).not.toBe(validatePassword('Abcdefg1!'));
  });
});
