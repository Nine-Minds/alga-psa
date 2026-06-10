/** @vitest-environment node */

/**
 * Regression guard for the shared "print one region, hide the app shell"
 * stylesheets. The bug being guarded: globals.css sets
 * `html, body, #__next { height: 100% }`, while hidden app chrome can still
 * participate in paged layout and produce trailing blank pages. The print hook
 * marks the ancestor path to the print region and marks sibling branches; the
 * stylesheets must remove those siblings from print layout and flatten the
 * preserved ancestors.
 *
 * These assertions parse the real CSS files rather than a snapshot so they fail
 * loudly if either half of the fix is removed or weakened.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/ui/src/components -> repo root
const repoRoot = path.resolve(here, '../../../../');

const CE_PRINT_CSS = path.join(repoRoot, 'server/src/app/print.css');
const EE_PRINT_CSS = path.join(
  repoRoot,
  'ee/packages/workflows/src/components/user-activities/userActivitiesPrint.css',
);

interface Rule {
  selectors: string[];
  declarations: Record<string, string>;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extract the body of the first `@media print { ... }` block (brace matched). */
function extractMediaPrintBlock(css: string): string | null {
  const marker = css.match(/@media\s+print\s*\{/);
  if (!marker || marker.index === undefined) return null;
  const start = marker.index + marker[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

/** Parse the flat `selector { decls }` rules inside an @media block. */
function parseRules(cssBlock: string): Rule[] {
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssBlock)) !== null) {
    const selectors = m[1]
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const declarations: Record<string, string> = {};
    for (const decl of m[2].split(';')) {
      const idx = decl.indexOf(':');
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1).replace(/!important/g, '').trim().toLowerCase();
      if (prop) declarations[prop] = value;
    }
    rules.push({ selectors, declarations });
  }
  return rules;
}

function printRules(file: string): Rule[] {
  const block = extractMediaPrintBlock(stripComments(readFileSync(file, 'utf8')));
  expect(block, `expected an @media print block in ${file}`).not.toBeNull();
  return parseRules(block!);
}

function ruleFor(rules: Rule[], selector: string): Rule | undefined {
  return rules.find((r) => r.selectors.includes(selector));
}

function ruleWithDecl(rules: Rule[], selector: string, property: string): Rule | undefined {
  return rules.find(
    (r) => r.selectors.includes(selector) && r.declarations[property] !== undefined,
  );
}

describe('shared print stylesheet removes non-print branches so no trailing blank pages print', () => {
  it('both print stylesheets exist', () => {
    expect(existsSync(CE_PRINT_CSS)).toBe(true);
    expect(existsSync(EE_PRINT_CSS)).toBe(true);
  });

  describe('CE server/src/app/print.css', () => {
    const rules = printRules(CE_PRINT_CSS);

    it('neutralizes the 100% height on html/body without clipping the viewport', () => {
      const htmlRule = ruleWithDecl(rules, 'html.app-print-mode', 'height');
      const bodyRule = ruleWithDecl(rules, 'html.app-print-mode body', 'height');

      expect(htmlRule?.declarations.height).toBe('auto');
      expect(htmlRule!.declarations['min-height']).toBe('0');
      expect(htmlRule!.declarations.overflow).toBe('visible');
      expect(bodyRule?.declarations.height).toBe('auto');
      expect(bodyRule!.declarations['min-height']).toBe('0');
      expect(bodyRule!.declarations.overflow).toBe('visible');
    });

    it('does NOT force a position on body', () => {
      const bodyRule = ruleFor(rules, 'html.app-print-mode body')!;
      expect(bodyRule.declarations.position).toBeUndefined();
    });

    it('removes non-print sibling branches from print layout', () => {
      const hiddenRule = ruleFor(rules, 'html.app-print-mode [data-app-print-hidden]');
      expect(hiddenRule?.declarations.display).toBe('none');
    });

    it('flattens preserved ancestors so wrappers cannot reserve a trailing page', () => {
      const preserveRule = ruleFor(rules, 'html.app-print-mode [data-app-print-preserve]');
      expect(preserveRule?.declarations.display).toBe('block');
      expect(preserveRule?.declarations.visibility).toBe('visible');
      expect(preserveRule?.declarations.position).toBe('static');
      expect(preserveRule?.declarations.overflow).toBe('visible');
      expect(preserveRule?.declarations.height).toBe('auto');
      expect(preserveRule?.declarations['max-height']).toBe('none');
    });

    it('prints the target in normal flow so multi-page content paginates naturally', () => {
      expect(ruleWithDecl(rules, 'html.app-print-mode .app-print-root', 'position')?.declarations.position).toBe('static');
      expect(ruleWithDecl(rules, 'html.app-print-mode [data-print-region]', 'position')?.declarations.position).toBe('static');
    });
  });

  describe('EE userActivitiesPrint.css', () => {
    const rules = printRules(EE_PRINT_CSS);

    it('neutralizes html/body height without clipping for both class names', () => {
      expect(ruleWithDecl(rules, 'html.app-print-mode', 'height')?.declarations.height).toBe('auto');
      expect(ruleWithDecl(rules, 'html.app-print-mode', 'height')?.declarations.overflow).toBe('visible');
      expect(ruleWithDecl(rules, 'html.ua-print-mode', 'height')?.declarations.height).toBe('auto');
      expect(ruleWithDecl(rules, 'html.ua-print-mode', 'height')?.declarations.overflow).toBe('visible');
      expect(ruleWithDecl(rules, 'html.app-print-mode body', 'height')?.declarations.height).toBe('auto');
      expect(ruleWithDecl(rules, 'html.app-print-mode body', 'height')?.declarations.overflow).toBe('visible');
      expect(ruleWithDecl(rules, 'html.ua-print-mode body', 'height')?.declarations.height).toBe('auto');
      expect(ruleWithDecl(rules, 'html.ua-print-mode body', 'height')?.declarations.overflow).toBe('visible');
    });

    it('removes non-print branches and flattens preserved ancestors for both class names', () => {
      expect(ruleFor(rules, 'html.app-print-mode [data-app-print-hidden]')?.declarations.display).toBe('none');
      expect(ruleFor(rules, 'html.ua-print-mode [data-app-print-hidden]')?.declarations.display).toBe('none');
      expect(ruleFor(rules, 'html.app-print-mode [data-app-print-preserve]')?.declarations.position).toBe('static');
      expect(ruleFor(rules, 'html.ua-print-mode [data-app-print-preserve]')?.declarations.position).toBe('static');
      expect(ruleFor(rules, 'html.app-print-mode [data-app-print-preserve]')?.declarations.height).toBe('auto');
      expect(ruleFor(rules, 'html.ua-print-mode [data-app-print-preserve]')?.declarations.height).toBe('auto');
    });

    it('prints the user-activities root in normal flow', () => {
      expect(ruleWithDecl(rules, 'html.app-print-mode .ua-print-root', 'position')?.declarations.position).toBe('static');
      expect(ruleWithDecl(rules, 'html.ua-print-mode .ua-print-root', 'position')?.declarations.position).toBe('static');
    });
  });
});
