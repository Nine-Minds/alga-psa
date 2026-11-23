/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getShortcutCatalogEntry } from './catalog';

const repoRoot = resolve(__dirname, '../../../..');
const productionLocales = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv'] as const;
const pseudoLocales = ['xx', 'yy'] as const;

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8'));
}

function valueAtPath(value: any, dottedPath: string): unknown {
  return dottedPath.split('.').reduce((current, part) => current?.[part], value);
}

describe('designer focus mode strings', () => {
  it('names the shortcut in every production locale', () => {
    const entry = getShortcutCatalogEntry('designer.toggleFocusMode');
    expect(entry).toBeDefined();

    for (const locale of productionLocales) {
      const namespace = readJson(`server/public/locales/${locale}/msp/keyboard-shortcuts.json`);
      expect(valueAtPath(namespace, entry!.labelKey)).toEqual(expect.any(String));
      expect(valueAtPath(namespace, entry!.descriptionKey!)).toEqual(expect.any(String));
      // The help dialog groups it under Editor.
      expect(valueAtPath(namespace, entry!.groupKey)).toEqual(expect.any(String));
    }
  });

  it('names the shortcut in the xx and yy pseudo-locales', () => {
    for (const locale of pseudoLocales) {
      const namespace = readJson(`server/public/locales/${locale}/msp/keyboard-shortcuts.json`);
      expect(valueAtPath(namespace, 'actions.designer.toggleFocusMode.label')).toEqual(expect.any(String));
      expect(valueAtPath(namespace, 'actions.designer.toggleFocusMode.description')).toEqual(expect.any(String));
    }
  });

  it('carries the toggle labels in common for every locale', () => {
    for (const locale of [...productionLocales, ...pseudoLocales]) {
      const common = readJson(`server/public/locales/${locale}/common.json`);
      expect(valueAtPath(common, 'designer.focusMode.enter')).toEqual(expect.any(String));
      expect(valueAtPath(common, 'designer.focusMode.exit')).toEqual(expect.any(String));
    }
  });

  it('keeps the Spanish strings in the usted register', () => {
    const strings = [
      valueAtPath(readJson('server/public/locales/es/common.json'), 'designer.focusMode.enter'),
      valueAtPath(readJson('server/public/locales/es/common.json'), 'designer.focusMode.exit'),
      valueAtPath(
        readJson('server/public/locales/es/msp/keyboard-shortcuts.json'),
        'actions.designer.toggleFocusMode.label'
      ),
      valueAtPath(
        readJson('server/public/locales/es/msp/keyboard-shortcuts.json'),
        'actions.designer.toggleFocusMode.description'
      ),
    ] as string[];

    for (const value of strings) {
      expect(value).toEqual(expect.any(String));
      // tú-register forms the es-419 glossary forbids.
      expect(value.toLowerCase()).not.toMatch(/\b(tú|tu|tus|quieres|visita|amplía|vuelve)\b/);
    }
  });
});
