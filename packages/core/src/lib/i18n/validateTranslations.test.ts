// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../../../scripts/validate-translations.cjs');

function runValidator(locales: Record<string, Record<string, unknown>>): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-fixture-'));
  try {
    for (const [locale, files] of Object.entries(locales)) {
      mkdirSync(join(dir, locale), { recursive: true });
      for (const [file, content] of Object.entries(files)) {
        writeFileSync(join(dir, locale, file), JSON.stringify(content));
      }
    }
    try {
      const output = execFileSync('node', [SCRIPT], {
        env: { ...process.env, LOCALES_DIR: dir },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, output };
    } catch (e: any) {
      return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('validate-translations CLDR plural awareness', () => {
  it('T053: does not warn on Polish _few/_many forms', () => {
    const { code, output } = runValidator({
      en: { 'common.json': { item_one: '{{count}} item', item_other: '{{count}} items' } },
      pl: {
        'common.json': {
          item_one: '{{count}} element',
          item_few: '{{count}} elementy',
          item_many: '{{count}} elementów',
          item_other: '{{count}} elementu',
        },
      },
    });
    expect(output).not.toContain('Extra key');
    expect(output).toContain('Warnings: 0');
    expect(code).toBe(0);
  });

  it('T054: errors when pl omits a required _many form', () => {
    const { code, output } = runValidator({
      en: { 'common.json': { item_one: '{{count}} item', item_other: '{{count}} items' } },
      pl: {
        'common.json': {
          item_one: '{{count}} element',
          item_few: '{{count}} elementy',
          item_other: '{{count}} elementu',
        },
      },
    });
    expect(code).toBe(1);
    expect(output).toContain('Missing plural form "item_many"');
  });

  it('T055: accepts en having only _one/_other; de needs only one/other', () => {
    const { code, output } = runValidator({
      en: { 'common.json': { item_one: '{{count}} item', item_other: '{{count}} items' } },
      de: { 'common.json': { item_one: '{{count}} Element', item_other: '{{count}} Elemente' } },
    });
    expect(output).not.toContain('item_few');
    expect(output).not.toContain('item_many');
    expect(code).toBe(0);
  });

  it('flags legacy _plural keys as errors', () => {
    const { code, output } = runValidator({
      en: { 'common.json': { item: '{{count}} item', item_plural: '{{count}} items' } },
      de: { 'common.json': { item: '{{count}} Element', item_plural: '{{count}} Elemente' } },
    });
    expect(code).toBe(1);
    expect(output).toContain('Legacy "_plural" key');
  });

  it('still errors on plural-form variable mismatches', () => {
    const { code, output } = runValidator({
      en: { 'common.json': { item_one: '{{count}} item', item_other: '{{count}} items' } },
      de: { 'common.json': { item_one: 'Element', item_other: '{{count}} Elemente' } },
    });
    expect(code).toBe(1);
    expect(output).toContain('variable mismatch');
  });
});
