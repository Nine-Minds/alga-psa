import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { REPO } from './importGraph';

/**
 * Client-bundle guard. The `@alga-psa/co-managed` barrel re-exports modules that import @alga-psa/db -> knex -> fs, so a
 * client component that value-imports it breaks the browser build ("Can't resolve 'fs'"). Every `'use client'` module under
 * server/src/components/co-managed, and every non-`'use server'` module they import (transitively), must use `import type`
 * or a subpath such as `@alga-psa/co-managed/conversationContent` instead.
 */
const BARREL = '@alga-psa/co-managed';
const SERVER_SRC = join(REPO, 'server/src');
const COMPONENTS = join(SERVER_SRC, 'components/co-managed');

const directive = (source: string, name: string) => ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest).statements
  .some(s => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === name);

/** Specifiers of an import/export/dynamic import that survives into the bundle, . */
export function valueImports(source: string): string[] {
  const file = ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause, named = clause?.namedBindings;
      const typeOnly = clause && (clause.isTypeOnly || (!clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(e => e.isTypeOnly)));
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function resolveLocal(from: string, spec: string, exists: (file: string) => boolean): string | null {
  const base = spec.startsWith('@/') ? join(SERVER_SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  return ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => base + ext).find(exists) ?? null;
}

/** Barrel value imports reachable from the client modules, as `file -> specifier`. Exported for the self-test below. */
export function barrelLeaks(roots: string[], read: (file: string) => string = f => readFileSync(f, 'utf8'), exists: (file: string) => boolean = existsSync): string[] {
  const seen = new Set<string>(), leaks: string[] = [];
  const queue = roots.filter(file => directive(read(file), 'use client'));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    if (directive(source, 'use server')) continue; // an action module runs on the server; the client only gets a reference
    for (const spec of valueImports(source)) {
      if (spec === BARREL) leaks.push(`${relative(REPO, file)} -> ${spec}`);
      const next = resolveLocal(file, spec, exists);
      if (next) queue.push(next);
    }
  }
  return leaks;
}

const components = readdirSync(COMPONENTS).filter(name => /\.tsx?$/.test(name)).map(name => join(COMPONENTS, name));

describe('co-managed client bundle', () => {
  it('no client-reachable module value-imports the @alga-psa/co-managed barrel', () => {
    expect(barrelLeaks(components)).toEqual([]);
  });

  it('detects a value import through a client component and through a helper it imports, and allows type and subpath imports', () => {
    const client = join(COMPONENTS, 'A.tsx'), helper = join(COMPONENTS, 'helper.ts');
    const files: Record<string, string> = {
      [client]: `'use client';\nimport { helper } from './helper';\nimport type { T } from '@alga-psa/co-managed';\nimport { x } from '@alga-psa/co-managed/conversationContent';\nimport { type U } from '@alga-psa/co-managed';`,
      [helper]: `import { encodeConversationContent } from '@alga-psa/co-managed';`,
    };
    expect(barrelLeaks([client], f => files[f] ?? '', f => f in files)).toEqual([`${relative(REPO, helper)} -> ${BARREL}`]);
    files[helper] = `import type { T } from '@alga-psa/co-managed';`;
    files[client] = files[client].replace('import type', 'import { encodeConversationContent } from \'@alga-psa/co-managed\';\nimport type');
    expect(barrelLeaks([client], f => files[f] ?? '', f => f in files)).toEqual([`${relative(REPO, client)} -> ${BARREL}`]);
  });

  it('the draft preview subpath does not reach the database', () => {
    const reach = new Set<string>(), queue = [join(REPO, 'packages/co-managed/src/conversationContent.ts')];
    while (queue.length) {
      const file = queue.pop()!;
      if (reach.has(file)) continue;
      reach.add(file);
      for (const spec of valueImports(readFileSync(file, 'utf8'))) {
        expect(spec.startsWith('.'), `${relative(REPO, file)} imports ${spec}`).toBe(true); // only sibling modules: no db, knex or node built-ins
        if (spec.startsWith('.')) queue.push(['.ts', '.tsx'].map(ext => resolve(dirname(file), spec) + ext).find(existsSync)!);
      }
    }
  });
});
