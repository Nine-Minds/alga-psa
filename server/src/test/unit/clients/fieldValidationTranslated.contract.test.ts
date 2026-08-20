/**
 * The field validators return stable i18n keys with English defaults. A call site
 * that renders the result without passing it through `translateFieldValidation`
 * shows English to every user regardless of locale — which is exactly what
 * happened once already, with all eight locale files fully populated and nothing
 * reading them.
 *
 * This walks the source rather than the rendered output because the failure is a
 * missing call, not a wrong string.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

const SEARCH_ROOTS = [
  'packages/auth/src',
  'packages/clients/src',
  'packages/onboarding/src',
  'server/src/components',
  'ee/server/src/components',
];

const FIELD_VALIDATOR = /\bvalidate(ClientName|ContactName|EmailAddress|PhoneNumber|WebsiteUrl)Field\b/;

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) return [];
    if (statSync(full).isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

describe('field validation results are translated where they are rendered', () => {
  const callers = SEARCH_ROOTS.flatMap((root) => walk(path.join(REPO_ROOT, root)))
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => FIELD_VALIDATOR.test(source));

  it('finds the call sites at all, so a rename cannot make this vacuous', () => {
    expect(callers.length).toBeGreaterThan(5);
  });

  for (const { file, source } of callers) {
    const relative = path.relative(REPO_ROOT, file);
    it(`${relative} routes the result through translateFieldValidation`, () => {
      expect(source).toContain('translateFieldValidation');
    });
  }
});
