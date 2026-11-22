import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T001 — F001 and T031 — F013 (plan `ee/plans/2026-11-21-itil-remediation`).
 *
 * The board field rules are the one implementation of R1–R7, so they have to be reachable from
 * every writer: server actions, REST services, `shared/workflow`, co-managed and the integrations
 * package. That means they must stay a plain module in `shared/` — importing a `'use server'`
 * action, a React component or the tickets package would make them unusable from at least one of
 * those callers, and would be found only at build time in the package that breaks.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

function json(relativePath: string): any {
  return JSON.parse(source(relativePath));
}

const RULES_MODULE = 'shared/lib/tickets/boardFieldRules.ts';
const MATRIX_MODULE = 'shared/lib/itil/priorityMatrix.ts';

function importSpecifiers(text: string): string[] {
  return [...text.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

describe('shared board field rules module contract', () => {
  it('T001: is exported from shared/package.json and built by shared/tsup.config.ts', () => {
    const exportsMap = json('shared/package.json').exports as Record<string, string>;
    expect(exportsMap['./lib/tickets/boardFieldRules']).toBe('./dist/lib/tickets/boardFieldRules.js');
    expect(exportsMap['./lib/itil/priorityMatrix']).toBe('./dist/lib/itil/priorityMatrix.js');

    const tsup = source('shared/tsup.config.ts');
    expect(tsup).toContain("'lib/tickets/boardFieldRules': 'lib/tickets/boardFieldRules.ts'");
    expect(tsup).toContain("'lib/itil/priorityMatrix': 'lib/itil/priorityMatrix.ts'");
  });

  it('T001: imports no server action, component or feature package', () => {
    for (const relativePath of [RULES_MODULE, MATRIX_MODULE]) {
      const text = source(relativePath);
      expect(text).not.toContain("'use server'");
      expect(text).not.toContain("'use client'");
      for (const specifier of importSpecifiers(text)) {
        expect(specifier, `${relativePath} imports ${specifier}`).not.toMatch(/\/actions(\/|$)/);
        expect(specifier, `${relativePath} imports ${specifier}`).not.toMatch(/\/components(\/|$)/);
        expect(specifier, `${relativePath} imports ${specifier}`).not.toMatch(
          /^@alga-psa\/(tickets|reference-data|co-managed|integrations|ui|sla)(\/|$)/
        );
        expect(specifier, `${relativePath} imports ${specifier}`).not.toMatch(/^(next|react)(\/|$)/);
      }
    }
  });

  it('T001: the four callers reach it by package subpath or relative path, never by copy', () => {
    // packages/tickets (the PR #3880 helpers now delegate)
    expect(source('packages/tickets/src/lib/ticketFieldReferences.ts')).toContain(
      "from '@alga-psa/shared/lib/tickets/boardFieldRules'"
    );
    // packages/tickets no longer keeps its own Impact × Urgency matrix
    const itilUtils = source('packages/tickets/src/lib/itilUtils.ts');
    expect(itilUtils).toContain("from '@alga-psa/shared/lib/itil/priorityMatrix'");
    expect(itilUtils).not.toContain('PRIORITY_MATRIX');

    // The subpath the other three use resolves for TypeScript (tsconfig paths) and at runtime
    // (package exports), and the file it names exists.
    const paths = json('tsconfig.base.json').compilerOptions.paths as Record<string, string[]>;
    expect(paths['@alga-psa/shared/*']).toEqual(['shared/*']);
    expect(fs.existsSync(path.resolve(REPO_ROOT, RULES_MODULE))).toBe(true);
  });
});

describe('REST priority API stays read-only', () => {
  const ROUTES = [
    'server/src/app/api/v1/priorities/route.ts',
    'server/src/app/api/v1/priorities/[id]/route.ts',
    'server/src/app/api/v1/tickets/priorities/route.ts',
  ];

  it('T031: no write verb is exported from any priority route', () => {
    for (const route of ROUTES) {
      const text = source(route);
      for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(text, `${route} exports ${verb}`).not.toMatch(new RegExp(`export\\s+(?:const|async function|function)\\s+${verb}\\b`));
      }
      expect(text).toMatch(/export\s+const\s+GET/);
    }
  });

  it('T031: PriorityService exposes no create, update or delete override', () => {
    const text = source('server/src/lib/api/services/PriorityService.ts');
    for (const method of ['create', 'update', 'delete']) {
      expect(text, `PriorityService overrides ${method}`).not.toMatch(
        new RegExp(`\\n\\s*(?:async\\s+)?${method}\\s*(?:<[^>]*>)?\\s*\\(`)
      );
    }
  });
});
