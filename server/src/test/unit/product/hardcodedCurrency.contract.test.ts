import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { CURRENCY_OPTIONS } from '@alga-psa/core';

// Hardcoded-currency guard: user-visible money must go through the currency
// formatters (useCurrencyFormat / formatCurrency / CurrencyInput), which respect
// the tenant's configured currency — never a literal "$". A grep can't do this
// job: `.replace(/…/, '$1')` regex groups and template-literal interpolation
// (`<td>${amount}</td>`) both look like dollar signs textually. So this suite
// parses candidate files with the TypeScript AST, where those are structurally
// distinct: it flags literal "$" only in JSX text, string literals, and the
// *static* chunks of template literals.
//
// Detected shapes:
//   `$${amount.toFixed(2)}`        — template chunk ending in "$" before an interpolation
//   <span>${amount}</span>         — JSX text "$" immediately before a JSX expression
//   <span>$5 off</span>            — JSX text containing $<digit>
//   '$0.00', "Starting at $299/mo" — string literal containing $<digit>
//   <span>$</span>                 — bare-symbol input adornment
//   {currencySymbol ?? '$'}        — bare-symbol fallback in a JSX expression
// (bare-symbol rules use useCurrencyFormat().symbol() as the fix; plain-object
//  currency maps like { USD: '$' } are property assignments and stay exempt)
//
// Every entry in the known list is either a deliberate USD surface (documented
// why) or a REPORTED GAP to burn down. Counts are exact: fixing a site without
// lowering the count fails the honesty test, adding one fails the growth test.
const KNOWN_HARDCODED_CURRENCY: Record<string, { count: number; why: string }> = {
  'ee/server/src/components/settings/account/AccountManagement.tsx': {
    count: 16,
    why: 'deliberate: Nine Minds subscription billing is USD (Stripe)',
  },
  'ee/server/src/components/workflow-designer/ActionSchemaReference.tsx': {
    count: 1,
    why: 'deliberate: renders expression-language ${path} syntax, not currency',
  },
  'ee/server/src/components/workflow-designer/expression-editor/functionDefinitions.ts': {
    count: 1,
    why: 'deliberate: builds $functionName tokens for the expression language, not currency',
  },
  'ee/server/src/components/workflow-designer/expression-editor/insertionText.ts': {
    count: 1,
    why: 'deliberate: "$0" is the snippet cursor placeholder, not currency',
  },
  'ee/server/src/services/chatWorkflowRegexTransformGuidance.ts': {
    count: 1,
    why: 'deliberate: documents regex replacement tokens ($1, $$), not currency',
  },
  'packages/client-portal/src/components/account/ServicesSection.tsx': {
    count: 3,
    why: 'REPORTED GAP: sample catalog tiles hardcode USD prices (locale twins in client-portal.json) — product call pending',
  },
  'packages/email/src/sendCancellationFeedbackEmail.ts': {
    count: 2,
    why: 'deliberate: Nine Minds subscription pricing is USD (Stripe)',
  },
  'packages/notifications/src/lib/templateVariables/seed.ts': {
    count: 8,
    why: 'deliberate: sample preview values documenting template-variable output',
  },
  'packages/validation/src/lib/clientFormValidation.ts': {
    count: 1,
    why: 'deliberate: "$1,000,000" is an illustrative example in a validation hint',
  },
  'server/src/app/static/master_terms/page.tsx': {
    count: 1,
    why: 'deliberate: legal terms — contractual amounts are USD',
  },
};

const KNOWN_LOCALE_HARDCODED: Record<string, string> = {
  'client-portal.json::account.services.catalog.cloudBackup.price':
    'REPORTED GAP: sample catalog tile hardcodes USD pricing',
  'client-portal.json::account.services.catalog.cybersecurity.price':
    'REPORTED GAP: sample catalog tile hardcodes USD pricing',
  'client-portal.json::account.services.catalog.managedIt.price':
    'REPORTED GAP: sample catalog tile hardcodes USD pricing',
};

const SOURCE_ROOTS = ['src', '../ee/server/src', '../packages'];

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  '__tests__',
  '__mocks__',
  'test',
  'tests',
  'migrations',
  'seeds',
]);

// Config files carry regex-replacement "$1" aliases and can't render user text.
const SKIP_FILES = [/\.(test|spec)\.(t|j)sx?$/, /\.stories\.(t|j)sx?$/, /\.d\.ts$/, /\.config\.(t|j)s$/];

const SOURCE_FILE = /\.(t|j)sx?$/;

// The guarded symbol set is derived from the product's own currency list, so
// adding a currency to CURRENCY_OPTIONS automatically extends this guard
// (including multi-character symbols like "C$" and "Fr.").
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SYMBOL_ALT = [...new Set(CURRENCY_OPTIONS.map((option) => option.symbol))]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|');

// A literal currency amount: a symbol followed by a digit (one optional
// space). Bare symbols ('¥' in a currency map) are fine; symbol+digit is a
// hardcoded price. $ is the only symbol with regex/template homonyms; the
// others are unambiguous everywhere.
const AMOUNT = new RegExp(`(?:${SYMBOL_ALT}) ?\\d`);
// Cheap prefilter so only files that could possibly violate get AST-parsed.
// symbol+digit catches strings/JSX amounts; "$" before "{" catches both the
// `$${x}` template shape and the JSX `<span>${x}</span>` shape.
const CANDIDATE = new RegExp(`(?:${SYMBOL_ALT}) ?\\d|\\$\\$?\\{|(?:${SYMBOL_ALT})\\s*<|['"](?:${SYMBOL_ALT})['"]`);
// Exactly one bare currency symbol (an input adornment or symbol fallback).
const BARE_SYMBOL = new RegExp(`^(?:${SYMBOL_ALT})$`);
// A template chunk or JSX text ending in a symbol, flowing into an interpolation.
const SYMBOL_END = new RegExp(`(?:${SYMBOL_ALT})$`);
const SYMBOL_END_LOOSE = new RegExp(`(?:${SYMBOL_ALT})\\s*$`);

const REPO_ROOT = path.resolve(process.cwd(), '..');

// LEVERAGE: pattern source-tree-walker — same recursive walker as routeEntryPointCoverage
function collectSourceFiles(absDir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(abs, out);
    } else if (SOURCE_FILE.test(entry.name) && !SKIP_FILES.some((skip) => skip.test(entry.name))) {
      out.push(abs);
    }
  }
}

interface Violation {
  file: string;
  line: number;
  snippet: string;
}

// `.replace(/…/, '$1')` replacement strings are regex group references.
function isReplaceArg(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    ts.isCallExpression(parent) &&
    parent.arguments.includes(node as ts.Expression) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    /^replace(All)?$/.test(parent.expression.name.text)
  );
}

// A bare-symbol string only counts when it flows into rendered JSX
// ({x ?? '$'} or prefix="$"); walking stops at anything else, so currency
// maps, call arguments, and plain assignments stay exempt.
function isJsxValueContext(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxExpression(p) || ts.isJsxAttribute(p)) return true;
    if (ts.isBinaryExpression(p) || ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p)) continue;
    return false;
  }
  return false;
}

// `new RegExp(`\\$${n}`)` builds a pattern, not a price tag.
function isRegExpArg(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    (ts.isNewExpression(parent) || ts.isCallExpression(parent)) &&
    !!parent.arguments?.includes(node as ts.Expression) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'RegExp'
  );
}

function scanFile(absFile: string, out: Violation[]): void {
  const text = fs.readFileSync(absFile, 'utf8');
  if (!CANDIDATE.test(text)) return;

  const scriptKind = /x$/.test(absFile) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, true, scriptKind);
  const file = path.relative(REPO_ROOT, absFile);

  const record = (node: ts.Node, snippet: string) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    out.push({ file, line: line + 1, snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 60) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (AMOUNT.test(node.text) && !isReplaceArg(node) && !isRegExpArg(node)) {
        record(node, node.text);
      } else if (BARE_SYMBOL.test(node.text) && isJsxValueContext(node)) {
        record(node, `bare '${node.text}' in JSX`);
      }
    } else if (ts.isTemplateExpression(node) && !isRegExpArg(node)) {
      const chunks = [node.head, ...node.templateSpans.map((span) => span.literal)];
      for (const chunk of chunks) {
        if (AMOUNT.test(chunk.text)) {
          record(chunk, chunk.text);
        } else if (SYMBOL_END.test(chunk.text) && !ts.isTemplateTail(chunk)) {
          // Static text ending in a symbol flows straight into an
          // interpolation: the `$${amount}` shape.
          record(chunk, `${chunk.text}\${…}`);
        }
      }
    } else if (ts.isJsxText(node)) {
      if (AMOUNT.test(node.text)) record(node, node.text);
      else if (BARE_SYMBOL.test(node.text.trim())) record(node, `bare '${node.text.trim()}' adornment`);
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children;
      for (let i = 0; i < children.length - 1; i++) {
        const child = children[i];
        const next = children[i + 1];
        if (
          ts.isJsxText(child) &&
          SYMBOL_END_LOOSE.test(child.text) &&
          !AMOUNT.test(child.text) &&
          !BARE_SYMBOL.test(child.text.trim()) &&
          ts.isJsxExpression(next)
        ) {
          record(child, `${child.text.trimStart()}{…}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function collectViolations(): Map<string, Violation[]> {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) {
    collectSourceFiles(path.resolve(process.cwd(), root), files);
  }
  const violations: Violation[] = [];
  for (const file of files) scanFile(file, violations);

  const byFile = new Map<string, Violation[]>();
  for (const violation of violations) {
    const list = byFile.get(violation.file) ?? [];
    list.push(violation);
    byFile.set(violation.file, list);
  }
  return byFile;
}

function describeFile(file: string, list: Violation[]): string {
  const lines = list.map((v) => `    L${v.line}: ${v.snippet}`).join('\n');
  return `  '${file}': { count: ${list.length}, why: '…' },\n${lines}`;
}

describe('hardcoded currency (source)', () => {
  const byFile = collectViolations();

  it('no user-visible hardcoded "$" outside the known list', () => {
    // The symbol set derives from the product currency list; if that import
    // ever breaks, every regex here degrades silently.
    expect(SYMBOL_ALT).toContain('Fr');
    expect(SYMBOL_ALT).toContain('€');

    const offenders = [...byFile.entries()]
      .filter(([file, list]) => {
        const known = KNOWN_HARDCODED_CURRENCY[file];
        return !known || list.length > known.count;
      })
      .sort(([a], [b]) => a.localeCompare(b));

    expect(
      offenders.map(([file]) => file),
      `hardcoded dollar signs in user-visible text — render money through the tenant-aware currency formatters (useCurrencyFormat / formatCurrency) instead. If a surface is deliberately USD, document it in KNOWN_HARDCODED_CURRENCY:\n${offenders
        .map(([file, list]) => describeFile(file, list))
        .join('\n')}`,
    ).toEqual([]);
  });

  it('known entries stay honest: counts match what is on disk', () => {
    for (const [file, { count }] of Object.entries(KNOWN_HARDCODED_CURRENCY)) {
      const actual = byFile.get(file)?.length ?? 0;
      expect(
        actual,
        actual === 0
          ? `"${file}" no longer has hardcoded currency — remove its KNOWN_HARDCODED_CURRENCY entry`
          : `"${file}" now has ${actual} hardcoded-currency sites (entry says ${count}) — update the count`,
      ).toBe(count);
    }
  });
});

const LOCALES_ROOT = path.resolve(process.cwd(), 'public/locales');

// Locale keys are namespace-relative (no locale segment), so one entry covers
// en and every translation of the same string.
function collectLocaleViolations(): Map<string, Set<string>> {
  const hits = new Map<string, Set<string>>();
  let locales: fs.Dirent[] = [];
  try {
    locales = fs.readdirSync(LOCALES_ROOT, { withFileTypes: true });
  } catch {
    return hits;
  }

  const walkJson = (value: unknown, jsonPath: string, nsPath: string, locale: string) => {
    if (typeof value === 'string') {
      if (AMOUNT.test(value)) {
        const key = `${nsPath}::${jsonPath}`;
        const set = hits.get(key) ?? new Set<string>();
        set.add(locale);
        hits.set(key, set);
      }
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        walkJson(v, jsonPath ? `${jsonPath}.${k}` : k, nsPath, locale);
      }
    }
  };

  for (const locale of locales) {
    if (!locale.isDirectory()) continue;
    const localeDir = path.join(LOCALES_ROOT, locale.name);
    const files: string[] = [];
    const collectJson = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) collectJson(abs);
        else if (entry.name.endsWith('.json')) files.push(abs);
      }
    };
    collectJson(localeDir);
    for (const file of files) {
      const nsPath = path.relative(localeDir, file);
      walkJson(JSON.parse(fs.readFileSync(file, 'utf8')), '', nsPath, locale.name);
    }
  }
  return hits;
}

describe('hardcoded currency (locale files)', () => {
  const hits = collectLocaleViolations();

  it('no translation string hardcodes "$" outside the known list', () => {
    const offenders = [...hits.keys()].filter((key) => !(key in KNOWN_LOCALE_HARDCODED)).sort();

    expect(
      offenders,
      `locale strings containing hardcoded dollar amounts — interpolate a formatted value ({{amount}}) instead, or document the key in KNOWN_LOCALE_HARDCODED: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('known locale entries stay honest', () => {
    for (const key of Object.keys(KNOWN_LOCALE_HARDCODED)) {
      expect(
        hits.has(key),
        `"${key}" no longer hardcodes currency in any locale — remove it from KNOWN_LOCALE_HARDCODED`,
      ).toBe(true);
    }
  });
});
