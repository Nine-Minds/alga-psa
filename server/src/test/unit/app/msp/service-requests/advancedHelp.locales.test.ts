import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'];
const dir = path.resolve(__dirname, '../../../../../../public/locales');
const load = (locale: string) =>
  JSON.parse(fs.readFileSync(path.join(dir, locale, 'msp/service-requests.json'), 'utf8'));
const get = (obj: any, key: string) => key.split('.').reduce((node, part) => node?.[part], obj);

const NEW_KEYS = [
  'editor.execution.visibility.description',
  ...[
    'whatItIs', 'ruleShapeTitle', 'ruleShape', 'ruleAll', 'ruleNone', 'ruleSource', 'ruleEarlier', 'ruleHidden',
    'operatorsTitle', 'operatorsIntro', 'contextTitle', 'contextIntro', 'placeholders.clientId',
    'placeholders.contactId', 'placeholders.requesterUserId', 'timingTitle', 'timing', 'editionTitle', 'edition',
    'examplesTitle', 'examples.showWhen.title', 'examples.hideWhen.title', 'examples.prefill.title', 'copy',
    'copied', 'copyFailed',
  ].map((suffix) => `editor.execution.advanced.help.${suffix}`),
];
const RENAMED_KEYS = [
  'editor.execution.visibility.title',
  'editor.execution.advanced.title',
  'editor.form.visibility.advancedJson',
];
const REMOVED_KEYS = [
  'editor.execution.visibility.config',
  'editor.execution.visibility.save',
  'messages.error.visibilityNotObject',
  'messages.error.visibilityInvalid',
];

describe('service-requests locale keys for the visibility help', () => {
  it.each(LOCALES)('%s has every new/renamed key and none of the removed ones', (locale) => {
    const data = load(locale);
    for (const key of [...NEW_KEYS, ...RENAMED_KEYS]) {
      expect(typeof get(data, key), `${locale}:${key}`).toBe('string');
      expect(get(data, key).length).toBeGreaterThan(0);
    }
    for (const key of REMOVED_KEYS) expect(get(data, key), `${locale}:${key}`).toBeUndefined();
    expect(get(data, 'editor.execution.advanced.save')).toBeTypeOf('string');
  });

  it('en carries the agreed titles', () => {
    const en = load('en');
    expect(get(en, 'editor.execution.visibility.title')).toBe('Who can see this form');
    expect(get(en, 'editor.execution.advanced.title')).toBe('Show or hide fields (advanced)');
    expect(get(en, 'editor.form.visibility.advancedJson')).toBe('Edit as JSON');
  });

  it('real locales translate the new titles (differ from en)', () => {
    const en = load('en');
    for (const locale of ['de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv']) {
      const data = load(locale);
      for (const key of ['editor.execution.visibility.title', 'editor.execution.advanced.title']) {
        expect(get(data, key), `${locale}:${key}`).not.toBe(get(en, key));
      }
    }
  });
});
