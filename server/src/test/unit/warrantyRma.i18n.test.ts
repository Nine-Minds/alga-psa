// T010: every translation key used by the new warranty/RMA components exists in every locale, and the
// components carry no hardcoded user-facing English.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '../../../..');
const localesDir = join(repo, 'server/public/locales');
const locales = readdirSync(localesDir).filter((d) => existsSync(join(localesDir, d, 'features')));

const COMPONENTS: Array<{ file: string; ns: 'features/inventory' | 'msp/assets' }> = [
  { file: 'packages/inventory/src/components/rma/RmaWarrantyPanel.tsx', ns: 'features/inventory' },
  { file: 'packages/inventory/src/components/rma/NewWarrantyClaimDialog.tsx', ns: 'features/inventory' },
  { file: 'packages/assets/src/components/warranty/WarrantyCard.tsx', ns: 'msp/assets' },
  { file: 'packages/assets/src/components/warranty/RmaBadge.tsx', ns: 'msp/assets' },
];
const RMA_STATUSES = [
  'warranty_review', 'open', 'awaiting_return', 'returned', 'sent_to_vendor', 'replacement_received',
  'replacement_deployed', 'dead_unit_owed', 'replaced', 'repaired', 'credited', 'charged', 'closed',
];

const read = (rel: string) => readFileSync(join(repo, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function staticKeys(src: string): string[] {
  return [...new Set([...stripComments(src).matchAll(/\bt\(\s*(['"`])([A-Za-z0-9_.]+)\1/g)].map((m) => m[2]))];
}
function dynamicPrefixes(src: string): string[] {
  return [...new Set([...stripComments(src).matchAll(/\bt\(\s*`([A-Za-z0-9_.]+\.)\$\{/g)].map((m) => m[1]))];
}
function lookup(json: any, key: string): unknown {
  if (json && Object.prototype.hasOwnProperty.call(json, key)) return json[key]; // flat dotted key
  return key.split('.').reduce<any>((cur, seg) => (cur && typeof cur === 'object' ? cur[seg] : undefined), json);
}
const nsFile = (locale: string, ns: string) => join(localesDir, locale, `${ns}.json`);

describe('warranty/RMA i18n (T010)', () => {
  it('discovers locales and component keys', () => {
    expect(locales.length).toBeGreaterThanOrEqual(8);
    for (const c of COMPONENTS) expect(staticKeys(read(c.file)).length).toBeGreaterThan(0);
  });

  for (const c of COMPONENTS) {
    describe(c.file.split('/').pop()!, () => {
      const src = read(c.file);
      const keys = staticKeys(src);
      // RmaWarrantyPanel/Dialog also use the shared `common.*` keys from the same namespace.
      it.each(locales)('%s has every static key', (locale) => {
        const json = JSON.parse(readFileSync(nsFile(locale, c.ns), 'utf8'));
        const missing = keys.filter((k) => typeof lookup(json, k) !== 'string' || (lookup(json, k) as string).trim() === '');
        expect(missing).toEqual([]);
      });

      it.each(locales)('%s resolves every dynamic status key', (locale) => {
        const json = JSON.parse(readFileSync(nsFile(locale, c.ns), 'utf8'));
        const missing: string[] = [];
        for (const prefix of dynamicPrefixes(src)) {
          for (const s of RMA_STATUSES) if (typeof lookup(json, prefix + s) !== 'string') missing.push(prefix + s);
        }
        expect(missing).toEqual([]);
      });

      it('has no hardcoded user-facing English', () => {
        const code = stripComments(src);
        const offenders: string[] = [];
        // JSX text nodes with letters
        for (const m of code.matchAll(/>([^<>{}=;()]*[A-Za-z]{2,}[^<>{}]*)</g)) {
          const text = m[1].trim();
          if (text && !/^[\s\W]*$/.test(text) && !/^(void|Promise|\s|\|)+$/.test(text) && // TS types, e.g. `void | Promise<...>`
             !/=>|\bextends\b|\bconst\b|\breturn\b/.test(text)) offenders.push(`text: ${text}`);
        }
        // Literal string props that render to the user
        for (const m of code.matchAll(/\b(label|placeholder|title|aria-label|alt|description|helperText)=\s*"([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
          offenders.push(`${m[1]}: ${m[2]}`);
        }
        expect(offenders).toEqual([]);
      });
    });
  }

  it('xx/yy pseudo-locales are present for the checked namespaces', () => {
    for (const l of ['xx', 'yy']) {
      expect(locales).toContain(l);
    }
  });
});
