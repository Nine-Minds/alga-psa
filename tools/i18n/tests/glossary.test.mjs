import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const translationsRoot = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(readFileSync(join(translationsRoot, 'locales.registry.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(translationsRoot, 'lib/glossary.schema.json'), 'utf8'));

function nonEmptyString(value, message) {
  assert.equal(typeof value, 'string', message);
  assert.notEqual(value.trim(), '', message);
}

function localizedTerm(entry, locale) {
  if (typeof entry.term === 'string') return entry.term;
  if (locale === 'pt' && typeof entry['pt-br-term'] === 'string') return entry['pt-br-term'];
  if (typeof entry[`${locale}-term`] === 'string') return entry[`${locale}-term`];
  const key = Object.keys(entry).find((name) => name !== 'en-term' && /^[a-z]{2}(?:-[a-z]{2})?-term$/.test(name));
  return key ? entry[key] : undefined;
}

function assertConformsToGlossaryShape(glossary, locale) {
  for (const field of ['locale', 'dialect', 'displayName', 'description']) {
    nonEmptyString(glossary[field], `${locale}: ${field} must be a non-empty string`);
  }
  for (const field of ['domainTerms', 'forbiddenTerms', 'dialectRules']) {
    assert.ok(Array.isArray(glossary[field]), `${locale}: ${field} must be an array`);
  }

  for (const entry of glossary.domainTerms) {
    nonEmptyString(entry.id, `${locale}: domain term id is required`);
    nonEmptyString(entry['en-term'], `${locale}:${entry.id} en-term is required`);
    nonEmptyString(localizedTerm(entry, locale), `${locale}:${entry.id} localized term is required`);
    nonEmptyString(entry.notes, `${locale}:${entry.id} notes are required`);
  }
  for (const entry of glossary.forbiddenTerms) {
    nonEmptyString(entry.term, `${locale}: forbidden term is required`);
    nonEmptyString(entry.preferred, `${locale}:${entry.term} preferred is required`);
    nonEmptyString(entry.reason, `${locale}:${entry.term} reason is required`);
  }
  for (const entry of glossary.dialectRules) {
    nonEmptyString(entry.id, `${locale}: dialect rule id is required`);
    nonEmptyString(entry.rule, `${locale}:${entry.id} rule is required`);
    nonEmptyString(entry.notes, `${locale}:${entry.id} notes are required`);
  }

  assert.equal(typeof glossary.identicalAllowlist, 'object', `${locale}: identicalAllowlist is required`);
  for (const field of ['exact', 'caseInsensitive', 'patterns']) {
    assert.ok(Array.isArray(glossary.identicalAllowlist[field]), `${locale}: allowlist ${field} must be an array`);
    for (const value of glossary.identicalAllowlist[field]) {
      assert.equal(typeof value, 'string', `${locale}: allowlist ${field} values must be strings`);
    }
  }
  assert.equal(typeof glossary.identicalAllowlist.notes, 'string', `${locale}: allowlist notes must be a string`);
}

test('glossary schema is valid JSON and describes an object', () => {
  assert.equal(schema.type, 'object');
  assert.ok(Array.isArray(schema.required));
  assert.ok(schema.required.includes('domainTerms'));
  assert.ok(schema.required.includes('identicalAllowlist'));
});

for (const [locale, config] of Object.entries(registry)) {
  test(`${locale} glossary conforms to the shared schema and invariants`, (t) => {
    const glossaryPath = join(repoRoot, config.dir, config.glossary);
    if (!existsSync(glossaryPath)) {
      t.skip(`${locale}: glossary not found at ${glossaryPath}`);
      return;
    }

    let glossary;
    assert.doesNotThrow(() => {
      glossary = JSON.parse(readFileSync(glossaryPath, 'utf8'));
    }, `${locale}: glossary must be valid JSON`);
    assertConformsToGlossaryShape(glossary, locale);
    assert.equal(glossary.locale, locale);
    assert.equal(glossary.dialect, config.dialect);

    const fold = (value) => value.trim().toLocaleLowerCase(config.dialect);
    const domainTerms = new Set(glossary.domainTerms.map((entry) => fold(localizedTerm(entry, locale))));
    for (const entry of glossary.forbiddenTerms) {
      assert.equal(entry.term, entry.term.toLocaleLowerCase(config.dialect), `${locale}: forbidden term must be lowercase: ${entry.term}`);
      if (!entry.enWhen) {
        // enWhen-scoped bans may legitimately overlap a domain term: the word is
        // correct in its own sense and banned only under a different English source
        // (es "presupuesto" = budget, banned when the source is a sales quote).
        assert.equal(domainTerms.has(fold(entry.term)), false, `${locale}: ${entry.term} is both a domain and forbidden term`);
      }
    }

    for (const pattern of glossary.identicalAllowlist.patterns) {
      assert.doesNotThrow(() => new RegExp(pattern, 'u'), `${locale}: invalid allowlist pattern: ${pattern}`);
    }
  });
}
