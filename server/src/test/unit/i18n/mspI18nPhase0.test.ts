import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  I18N_CONFIG as UI_I18N_CONFIG,
  LOCALE_CONFIG as UI_LOCALE_CONFIG,
  ROUTE_NAMESPACES,
  getNamespacesForRoute,
} from '@alga-psa/ui/lib/i18n/config';

const repoRoot = path.resolve(__dirname, '../../../../..');
const localesRoot = path.join(repoRoot, 'server/public/locales');

const readRepoFile = (relativePathFromRepoRoot: string): string => {
  return fs.readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
};

const readJson = (relativePathFromRepoRoot: string): any => {
  return JSON.parse(readRepoFile(relativePathFromRepoRoot));
};

const fileExists = (relativePathFromRepoRoot: string): boolean => {
  return fs.existsSync(path.join(repoRoot, relativePathFromRepoRoot));
};

const collectJsonFiles = (dir: string, baseDir = dir): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(path.relative(baseDir, fullPath));
    }
  }

  return results;
};

const collectKeyPaths = (obj: any, prefix = ''): string[] => {
  if (!obj || typeof obj !== 'object') return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    paths.push(currentPath);
    paths.push(...collectKeyPaths(value, currentPath));
  }
  return paths;
};

const collectLeafStrings = (obj: any): string[] => {
  if (typeof obj === 'string') return [obj];
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    return obj.flatMap((value) => collectLeafStrings(value));
  }
  return Object.values(obj).flatMap((value) => collectLeafStrings(value));
};

const findVariableLeaf = (
  obj: any,
  minCount: number,
  prefix = ''
): { path: string; value: string; variables: string[] } | null => {
  if (typeof obj === 'string') {
    const matches = obj.match(/\{\{\s*[^}]+\s*\}\}/g) ?? [];
    if (matches.length >= minCount) {
      return { path: prefix, value: obj, variables: matches.map((match) => match.trim()) };
    }
    return null;
  }

  if (!obj || typeof obj !== 'object') {
    return null;
  }

  if (Array.isArray(obj)) {
    for (let index = 0; index < obj.length; index += 1) {
      const found = findVariableLeaf(obj[index], minCount, `${prefix}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  for (const [key, value] of Object.entries(obj)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const found = findVariableLeaf(value, minCount, nextPrefix);
    if (found) return found;
  }

  return null;
};

const getValueAtPath = (obj: any, keyPath: string): any => {
  if (!keyPath) return obj;
  const segments = keyPath.split('.');
  let current = obj as any;
  for (const segment of segments) {
    const arrayMatch = segment.match(/(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      const index = Number(arrayMatch[2]);
      current = current?.[key]?.[index];
      continue;
    }
    current = current?.[segment];
  }
  return current;
};

const runPseudoLocale = (locale: string, fill: string) => {
  const tsNodePath = path.join(repoRoot, 'node_modules/.bin/ts-node');
  execFileSync(tsNodePath, [
    path.join(repoRoot, 'scripts/generate-pseudo-locale.ts'),
    '--locale',
    locale,
    '--fill',
    fill,
  ], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
};

const pseudoLocale = 'xx';
const pseudoFill = '1111';
const pseudoLocaleRoot = path.join(localesRoot, pseudoLocale);
const englishRoot = path.join(localesRoot, 'en');

const locales = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl'] as const;

describe('MSP i18n Phase 0 - config', () => {
  it('T001: UI I18N_CONFIG.ns is ["common"]', () => {
    expect(UI_I18N_CONFIG.ns).toEqual(['common']);
  });

  it('T002/T042: Core I18N_CONFIG.ns is ["common"]', () => {
    const coreConfig = readRepoFile('packages/core/src/lib/i18n/config.ts');
    expect(coreConfig).toContain("ns: ['common']");
  });

  it('T003: ROUTE_NAMESPACES is exported', () => {
    expect(ROUTE_NAMESPACES).toBeDefined();
  });

  it('T004-T009: ROUTE_NAMESPACES entries are correct and use msp/core', () => {
    expect(ROUTE_NAMESPACES['/client-portal']).toEqual(['common', 'client-portal']);
    expect(ROUTE_NAMESPACES['/client-portal/tickets']).toEqual([
      'common',
      'client-portal',
      'features/tickets',
    ]);
    expect(ROUTE_NAMESPACES['/msp']).toEqual(['common', 'msp/core']);
    expect(ROUTE_NAMESPACES['/msp/tickets']).toEqual([
      'common',
      'msp/core',
      'features/tickets',
    ]);
    expect(ROUTE_NAMESPACES['/msp/settings']).toEqual(['common', 'msp/core']);

    const hasLegacyMsp = Object.values(ROUTE_NAMESPACES).some((namespaces) =>
      namespaces.includes('msp')
    );
    expect(hasLegacyMsp).toBe(false);
  });

  it('T010-T015: getNamespacesForRoute resolves exact, prefix, and fallback correctly', () => {
    expect(getNamespacesForRoute('/msp/tickets')).toEqual(
      ROUTE_NAMESPACES['/msp/tickets']
    );
    expect(getNamespacesForRoute('/client-portal/billing')).toEqual(
      ROUTE_NAMESPACES['/client-portal/billing']
    );
    expect(getNamespacesForRoute('/msp/tickets/123')).toEqual(
      ROUTE_NAMESPACES['/msp/tickets']
    );
    expect(getNamespacesForRoute('/unknown/route')).toEqual(['common']);
  });

  it('T033-T035/T043: pseudo locales included in config', () => {
    expect(UI_LOCALE_CONFIG.supportedLocales).toContain('xx');
    expect(UI_LOCALE_CONFIG.supportedLocales).toContain('yy');
    expect(UI_I18N_CONFIG.supportedLngs).toContain('xx');
    expect(UI_I18N_CONFIG.supportedLngs).toContain('yy');
    const coreConfig = readRepoFile('packages/core/src/lib/i18n/config.ts');
    for (const locale of UI_LOCALE_CONFIG.supportedLocales) {
      expect(coreConfig).toContain(`'${locale}'`);
    }
    expect(coreConfig).toContain("xx: 'Pseudo (xx)'");
    expect(coreConfig).toContain("yy: 'Pseudo (yy)'");
  });
});

describe('MSP i18n Phase 0 - wrapper/provider wiring', () => {
  it('T016-T019: I18nProvider accepts namespaces and loads missing namespaces', () => {
    const src = readRepoFile('packages/ui/src/lib/i18n/client.tsx');
    expect(src).toContain('namespaces?: string[]');
    expect(src).toContain('i18next.loadNamespaces');
    expect(src).toContain('i18next.hasResourceBundle');
    expect(src).toMatch(/\[isInitialized, locale, namespaces\]/);
  });

  it('T020-T022: I18nWrapper uses usePathname and passes namespaces', () => {
    const src = readRepoFile('packages/tenancy/src/components/i18n/I18nWrapper.tsx');
    expect(src).toContain('usePathname');
    expect(src).toContain('getNamespacesForRoute');
    expect(src).toContain('namespaces={namespaces}');
    expect(src).toContain('useMemo');
  });
});

describe('MSP i18n Phase 0 - pseudo locale generator', () => {
  beforeAll(() => {
    runPseudoLocale(pseudoLocale, pseudoFill);
  });

  afterAll(async () => {
    if (fs.existsSync(pseudoLocaleRoot)) {
      await fsPromises.rm(pseudoLocaleRoot, { recursive: true, force: true });
    }
  });

  it('T023-T027: pseudo-locale files are generated with preserved structure', () => {
    expect(fileExists(`server/public/locales/${pseudoLocale}`)).toBe(true);

    const englishFiles = collectJsonFiles(englishRoot);
    const generatedFiles = collectJsonFiles(pseudoLocaleRoot);

    expect(generatedFiles.sort()).toEqual(englishFiles.sort());
    expect(fileExists(`server/public/locales/${pseudoLocale}/features/tickets.json`)).toBe(true);
    expect(fileExists(`server/public/locales/${pseudoLocale}/msp/core.json`)).toBe(true);
  });

  it('T028/T032: pseudo-locale leaf strings are replaced with fill token', () => {
    const common = readJson(`server/public/locales/${pseudoLocale}/common.json`);
    const leafStrings = collectLeafStrings(common);
    expect(leafStrings.length).toBeGreaterThan(0);
    for (const value of leafStrings) {
      expect(value).toContain(pseudoFill);
    }

    const originalCommon = readJson('server/public/locales/en/common.json');
    expect(collectKeyPaths(common).sort()).toEqual(collectKeyPaths(originalCommon).sort());
  });

  it('T029-T031: pseudo-locale preserves variables and JSON structure', () => {
    const englishFiles = collectJsonFiles(englishRoot);
    let singleVar: { file: string; path: string; variables: string[] } | null = null;
    let multiVar: { file: string; path: string; variables: string[] } | null = null;

    for (const relativeFile of englishFiles) {
      const englishJson = readJson(path.join('server/public/locales/en', relativeFile));
      if (!singleVar) {
        const found = findVariableLeaf(englishJson, 1);
        if (found) {
          singleVar = { file: relativeFile, path: found.path, variables: found.variables };
        }
      }
      if (!multiVar) {
        const found = findVariableLeaf(englishJson, 2);
        if (found) {
          multiVar = { file: relativeFile, path: found.path, variables: found.variables };
        }
      }
      if (singleVar && multiVar) break;
    }

    expect(singleVar).not.toBeNull();
    expect(multiVar).not.toBeNull();

    if (singleVar) {
      const pseudoJson = readJson(path.join('server/public/locales', pseudoLocale, singleVar.file));
      const pseudoValue = getValueAtPath(pseudoJson, singleVar.path) as string;
      for (const variable of singleVar.variables) {
        expect(pseudoValue).toContain(variable);
      }
    }

    if (multiVar) {
      const pseudoJson = readJson(path.join('server/public/locales', pseudoLocale, multiVar.file));
      const pseudoValue = getValueAtPath(pseudoJson, multiVar.path) as string;
      for (const variable of multiVar.variables) {
        expect(pseudoValue).toContain(variable);
      }
    }
  });
});

describe('MSP i18n Phase 0 - namespace files and references', () => {
  it('T036-T038: msp/core.json exists for all locales and legacy msp.json removed', () => {
    for (const locale of locales) {
      expect(fileExists(`server/public/locales/${locale}/msp/core.json`)).toBe(true);
      expect(fileExists(`server/public/locales/${locale}/msp.json`)).toBe(false);
    }
  });

  it('T039-T040: no legacy msp namespace usage remains in source', () => {
    const pattern = /useTranslation\('msp'\)/;
    const dirsToScan = ['server/src', 'packages', 'ee'].map((d) => path.join(repoRoot, d));
    const matches: string[] = [];

    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
          scanDir(fullPath);
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (pattern.test(content)) {
            matches.push(path.relative(repoRoot, fullPath));
          }
        }
      }
    };

    for (const dir of dirsToScan) {
      scanDir(dir);
    }

    expect(matches).toEqual([]);

    const phase1Test = readRepoFile('server/src/test/unit/i18n/mspI18nPhase1.test.ts');
    expect(phase1Test).toContain("ns: 'msp/core'");
    expect(phase1Test).not.toContain("ns: 'msp'");
  });
});

describe('MSP i18n Phase 0 - portal routing expectations', () => {
  it('T044-T046: client portal namespace expectations are mapped', () => {
    expect(getNamespacesForRoute('/client-portal')).toEqual(
      ROUTE_NAMESPACES['/client-portal']
    );
    expect(getNamespacesForRoute('/client-portal/tickets')).toEqual(
      ROUTE_NAMESPACES['/client-portal/tickets']
    );
  });

  it('T047-T050: MSP portal namespace expectations are mapped', () => {
    expect(getNamespacesForRoute('/msp')).toEqual(ROUTE_NAMESPACES['/msp']);
    expect(getNamespacesForRoute('/msp/tickets')).toEqual(
      ROUTE_NAMESPACES['/msp/tickets']
    );
  });
});
