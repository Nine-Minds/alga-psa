/**
 * T100 (F100) + T246–T248 (F235–F237) — static i18n verification for the Hudu UI.
 *
 * Two halves:
 * 1. Key resolution — every `t('integrations.hudu…' / 'integrations.categories.
 *    itDocumentation…' / 'integrations.items.hudu…' / 'clientDetails.hudu…' /
 *    'documents.huduTab…')` key used by the Hudu components (plus the two
 *    ClientDetails tab labels, the IntegrationsSettingsPage category/item
 *    entries, and the two DocumentsPage tab labels) must resolve to a
 *    non-empty string in the matching en locale JSON for its namespace:
 *    msp/integrations → msp/integrations.json, msp/clients → msp/clients.json,
 *    msp/settings → msp/settings.json, common → common.json.
 * 2. Hardcoded-string sweep — no literal user-facing text nodes in the Hudu
 *    component JSX (everything must go through t(key, { defaultValue })).
 *
 * Component sources are read via Vite `?raw` imports (jsdom-safe precedent:
 * huduClientPasswordsTabGate); locale JSONs via fs (huduDeletionBoundary
 * precedent). No rendering, no DB, no network.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// @ts-expect-error Vite raw import (static source scan).
import huduIntegrationSettingsSource from '@ee/components/settings/integrations/HuduIntegrationSettings.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import huduCompanyMappingManagerSource from '@ee/components/settings/integrations/hudu/HuduCompanyMappingManager.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import huduClientTabSource from '@ee/components/integrations/hudu/HuduClientTab.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import huduClientPasswordsTabSource from '@ee/components/integrations/hudu/HuduClientPasswordsTab.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import huduAssetLayoutMapManagerSource from '@ee/components/settings/integrations/hudu/HuduAssetLayoutMapManager.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import huduAssetMappingManagerSource from '@ee/components/integrations/hudu/HuduAssetMappingManager.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import huduClientDocumentsSectionSource from '@ee/components/integrations/hudu/HuduClientDocumentsSection.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import huduDocumentsTabSource from '@ee/components/integrations/hudu/HuduDocumentsTab.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import clientDetailsSource from '@alga-psa/clients/components/clients/ClientDetails.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import integrationsSettingsPageSource from '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage.tsx?raw';
// @ts-expect-error Vite raw import (static source scan).
import documentsPageSource from '@alga-psa/documents/components/DocumentsPage.tsx?raw';

const repoRoot = path.resolve(process.cwd(), '..', '..');

function readLocale(file: string, locale = 'en'): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'server', 'public', 'locales', locale, file), 'utf8')
  );
}

const locales = {
  'msp/integrations': readLocale('msp/integrations.json'),
  'msp/clients': readLocale('msp/clients.json'),
  'msp/settings': readLocale('msp/settings.json'),
  common: readLocale('common.json'),
} as const;

type Namespace = keyof typeof locales;

/** Only the Hudu-owned key families are this test's concern. */
const HUDU_KEY_PATTERN =
  /^(integrations\.hudu\.|integrations\.categories\.itDocumentation\.|integrations\.items\.hudu\.|clientDetails\.hudu|documents\.huduTab\.)/;

/** All `t('…')` first-argument string literals in a source. */
function collectTranslationKeys(source: string): string[] {
  const keys: string[] = [];
  const re = /\bt\(\s*['"]([^'"]+)['"]/g;
  for (let match = re.exec(source); match !== null; match = re.exec(source)) {
    keys.push(match[1]);
  }
  return keys;
}

function collectHuduKeys(source: string): string[] {
  return collectTranslationKeys(source).filter((key) => HUDU_KEY_PATTERN.test(key));
}

function resolveKey(locale: Record<string, unknown>, key: string): unknown {
  let node: unknown = locale;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

interface ScannedSource {
  label: string;
  source: string;
  namespace: Namespace;
  /** Lower bound on collected keys — guards the extraction regex against rot. */
  minKeys: number;
  /** Hudu-owned components get the hardcoded-string sweep; host pages do not. */
  sweep: boolean;
}

const keySources: ScannedSource[] = [
  {
    label: 'HuduIntegrationSettings.tsx',
    source: huduIntegrationSettingsSource as string,
    namespace: 'msp/integrations',
    minKeys: 25,
    sweep: true,
  },
  {
    label: 'HuduCompanyMappingManager.tsx',
    source: huduCompanyMappingManagerSource as string,
    namespace: 'msp/integrations',
    minKeys: 25,
    sweep: true,
  },
  {
    label: 'HuduClientTab.tsx',
    source: huduClientTabSource as string,
    namespace: 'msp/integrations',
    minKeys: 10,
    sweep: true,
  },
  {
    label: 'HuduClientPasswordsTab.tsx',
    source: huduClientPasswordsTabSource as string,
    namespace: 'msp/integrations',
    minKeys: 14,
    sweep: true,
  },
  {
    label: 'HuduAssetLayoutMapManager.tsx',
    source: huduAssetLayoutMapManagerSource as string,
    namespace: 'msp/integrations',
    minKeys: 18,
    sweep: true,
  },
  {
    label: 'HuduAssetMappingManager.tsx',
    source: huduAssetMappingManagerSource as string,
    namespace: 'msp/integrations',
    minKeys: 40,
    sweep: true,
  },
  {
    label: 'HuduClientDocumentsSection.tsx',
    source: huduClientDocumentsSectionSource as string,
    namespace: 'msp/integrations',
    minKeys: 4,
    sweep: true,
  },
  {
    label: 'HuduDocumentsTab.tsx',
    source: huduDocumentsTabSource as string,
    namespace: 'msp/integrations',
    minKeys: 14,
    sweep: true,
  },
  {
    label: 'ClientDetails.tsx (hudu tab labels)',
    source: clientDetailsSource as string,
    namespace: 'msp/clients',
    minKeys: 2,
    sweep: false,
  },
  {
    label: 'IntegrationsSettingsPage.tsx (category + item)',
    source: integrationsSettingsPageSource as string,
    namespace: 'msp/settings',
    minKeys: 4,
    sweep: false,
  },
  {
    label: 'DocumentsPage.tsx (hudu tab labels)',
    source: documentsPageSource as string,
    namespace: 'common',
    minKeys: 2,
    sweep: false,
  },
];

describe('T100: every Hudu translation key resolves in the en locale', () => {
  it.each(keySources)('$label keys resolve in $namespace', ({ source, namespace, minKeys, label }) => {
    const keys = collectHuduKeys(source);
    expect(keys.length, `${label}: key extraction found too few keys — regex rot?`).toBeGreaterThanOrEqual(
      minKeys
    );

    const missing = keys.filter((key) => {
      const value = resolveKey(locales[namespace], key);
      return typeof value !== 'string' || value.trim() === '';
    });
    expect(missing, `${label}: keys missing from ${namespace} locale`).toEqual([]);
  });

  it('the two ClientDetails Hudu tab labels are exactly the expected keys', () => {
    const keys = collectHuduKeys(clientDetailsSource as string).sort();
    expect(keys).toEqual(['clientDetails.huduPasswordsTab', 'clientDetails.huduTab']);
  });

  it('the two DocumentsPage Hudu tab labels are exactly the expected keys', () => {
    const keys = collectHuduKeys(documentsPageSource as string).sort();
    expect(keys).toEqual(['documents.huduTab.documentsTabLabel', 'documents.huduTab.tabLabel']);
  });
});

// Every shipped real language (xx/yy pseudo-locales excluded by convention).
const TRANSLATED_LOCALES = ['de', 'es', 'fr', 'it', 'nl', 'pl', 'pt'] as const;
const NAMESPACE_FILES: Record<Namespace, string> = {
  'msp/integrations': 'msp/integrations.json',
  'msp/clients': 'msp/clients.json',
  'msp/settings': 'msp/settings.json',
  common: 'common.json',
};

describe('T100: every Hudu translation key is translated in every shipped locale', () => {
  it.each(TRANSLATED_LOCALES)('all Hudu keys resolve in the %s locale', (locale) => {
    const localeData = Object.fromEntries(
      (Object.keys(NAMESPACE_FILES) as Namespace[]).map((ns) => [
        ns,
        readLocale(NAMESPACE_FILES[ns], locale),
      ])
    ) as Record<Namespace, Record<string, unknown>>;

    const missing: string[] = [];
    for (const { source, namespace } of keySources) {
      for (const key of collectHuduKeys(source)) {
        const value = resolveKey(localeData[namespace], key);
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${locale}:${namespace}:${key}`);
        }
      }
    }
    expect(missing, `keys missing or empty in the ${locale} locale`).toEqual([]);
  });
});

/**
 * Hardcoded-string heuristic (documented, deliberately pragmatic):
 *
 * 1. Strip block comments and whole-line `//` comments (mid-line `//` is left
 *    alone so `https://…` string literals survive).
 * 2. Find literal JSX text-node candidates: a run of characters between a `>`
 *    (not the `=>` arrow) and the next tag-opening `<` that contains NO
 *    braces. Translated text always renders through a `{t(…)}` expression, so
 *    a brace-free text node is literal.
 * 3. Reject candidates containing code-shaped characters (; = ( ) `) — these
 *    are TS code regions (generics, statements), not prose. A hardcoded UI
 *    sentence has none of them. (Tradeoff: a literal sentence containing
 *    parentheses would slip through — accepted for pragmatism.)
 * 4. Flag a surviving node when it contains MORE THAN TWO words (3+ runs of
 *    2+ ASCII letters) — the `<span>Some english sentence</span>` shape.
 *    Non-UI strings (ids, classNames, console/log strings, attribute values)
 *    live inside braces, quotes or tags and are structurally excluded.
 * 5. Belt-and-braces: user-facing JSX attributes (label/placeholder/title/
 *    alt/aria-label) must not be literal multi-word strings either.
 *
 * ALLOWLIST: add a literal here only for deliberate non-UI text.
 */
const HARDCODED_TEXT_ALLOWLIST: string[] = [];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function wordCount(text: string): number {
  return (text.match(/[A-Za-z]{2,}/g) ?? []).length;
}

function findHardcodedTextNodes(source: string): string[] {
  const violations: string[] = [];
  const stripped = stripComments(source);

  const textNode = /(?<!=)>([^<>{}]+)<(?=[A-Za-z/])/g;
  for (let match = textNode.exec(stripped); match !== null; match = textNode.exec(stripped)) {
    const text = match[1].trim();
    if (/[;=()`]/.test(text)) continue; // code region, not a JSX text node
    if (wordCount(text) > 2 && !HARDCODED_TEXT_ALLOWLIST.includes(text)) {
      violations.push(text);
    }
  }

  const uiAttribute = /\b(?:label|placeholder|title|alt|aria-label)=["']([^"']+)["']/g;
  for (let match = uiAttribute.exec(stripped); match !== null; match = uiAttribute.exec(stripped)) {
    const text = match[1].trim();
    if (wordCount(text) > 2 && !HARDCODED_TEXT_ALLOWLIST.includes(text)) {
      violations.push(`[attribute] ${text}`);
    }
  }

  return violations;
}

describe('T100: no hardcoded user-facing strings in the Hudu components', () => {
  const componentSources = keySources.filter((entry) => entry.sweep); // the Hudu-owned components

  it.each(componentSources)('$label has no literal multi-word JSX text', ({ source, label }) => {
    expect(findHardcodedTextNodes(source), `${label}: untranslated literal text`).toEqual([]);
  });

  it('the heuristic itself catches a hardcoded sentence (self-test)', () => {
    const offender = '<span className="x">Some english sentence here</span>';
    expect(findHardcodedTextNodes(offender)).toEqual(['Some english sentence here']);
    expect(findHardcodedTextNodes('<span>{t("k", { defaultValue: "Some english sentence" })}</span>')).toEqual(
      []
    );
    expect(findHardcodedTextNodes('<Input placeholder="Enter your Hudu key" />')).toEqual([
      '[attribute] Enter your Hudu key',
    ]);
  });
});
