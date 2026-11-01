// @vitest-environment node
/**
 * Next.js rejects any non-async runtime export from a 'use server' module
 * ("Server Actions must be async functions") and fails the whole route build.
 * Types and interfaces are erased and therefore allowed.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const actionsDir = __dirname;

function listSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSources(full);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')
      ? [full]
      : [];
  });
}

function isUseServer(sf: ts.SourceFile): boolean {
  const first = sf.statements[0];
  return Boolean(
    first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === 'use server'
  );
}

function hasExport(node: ts.Node): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}
function hasAsync(node: ts.Node): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
}

export function findNonAsyncRuntimeExports(sf: ts.SourceFile): string[] {
  const bad: string[] = [];
  // Local declarations, so `export { name }` can be resolved.
  const locals = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) locals.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) locals.set(d.name.text, d);
      }
    }
    if (ts.isClassDeclaration(st) && st.name) locals.set(st.name.text, st);
    if (ts.isEnumDeclaration(st)) locals.set(st.name.text, st);
  }
  const isAsyncFn = (n: ts.Node | undefined): boolean =>
    !!n &&
    (((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) && hasAsync(n)) ||
      (ts.isVariableDeclaration(n) && isAsyncFn(n.initializer)) ||
      (ts.isParenthesizedExpression(n) && isAsyncFn(n.expression)) ||
      // Auth/permission wrappers such as withAuth(async (...) => ...) yield an async action.
      (ts.isCallExpression(n) && n.arguments.some((a) => isAsyncFn(a))));

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && hasExport(st)) {
      if (!hasAsync(st) || st.asteriskToken) bad.push(st.name?.text ?? 'default');
    } else if (ts.isVariableStatement(st) && hasExport(st)) {
      for (const d of st.declarationList.declarations) {
        if (!isAsyncFn(d)) bad.push(d.name.getText(sf));
      }
    } else if ((ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && hasExport(st)) {
      bad.push(st.name?.text ?? 'default');
    } else if (ts.isExportAssignment(st)) {
      if (!isAsyncFn(st.expression) && !(ts.isIdentifier(st.expression) && isAsyncFn(locals.get(st.expression.text)))) {
        bad.push('default');
      }
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (el.isTypeOnly) continue;
        const local = locals.get((el.propertyName ?? el.name).text);
        if (local && !isAsyncFn(local)) bad.push(el.name.text);
      }
    }
  }
  return bad;
}

describe("'use server' modules under packages/tickets/src/actions", () => {
  const files = listSources(actionsDir)
    .map((file) => ({ file, sf: ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true) }))
    .filter(({ sf }) => isUseServer(sf));

  it('finds the server-action modules', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map(({ file, sf }) => [path.relative(actionsDir, file), sf] as const))(
    '%s exports only async functions at runtime',
    (_name, sf) => {
      expect(findNonAsyncRuntimeExports(sf)).toEqual([]);
    }
  );
});
