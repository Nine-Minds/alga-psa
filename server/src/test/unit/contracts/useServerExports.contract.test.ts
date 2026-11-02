import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Next refuses any non-async-function runtime export from a 'use server' file
 * (it fails the build of every route importing it). This scans every such file
 * under server/src/lib/actions with the TypeScript parser. Types are erased, so
 * `export type` / `export interface` are allowed. `export const x = withAuth(async ...)`
 * (a wrapper call that receives an async function) is the repo's action shape.
 */
const ACTIONS_DIR = path.resolve(__dirname, '../../../lib/actions');

/** Pre-existing violations outside L1b, recorded rather than fixed here. */
const ALLOWLIST: Record<string, string[]> = {
  // 'relative/path.ts': ['exportName', ...]  — comment why each entry exists
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [full] : [];
  });
}

const isAsyncFn = (n: ts.Node): boolean =>
  (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}

function isUseServer(sf: ts.SourceFile): boolean {
  const first = sf.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use server';
}

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === kind);

/** Returns a description of each export that is not an async function. */
export function findUseServerViolations(source: string, fileName = 'file.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (!isUseServer(sf)) return [];
  const out: string[] = [];
  const localAsyncFns = new Set<string>();
  const localOther = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && hasModifier(st, ts.SyntaxKind.AsyncKeyword)) localAsyncFns.add(st.name.text);
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) {
        const init = d.initializer && unwrap(d.initializer);
        if (init && isAsyncFn(init)) localAsyncFns.add(d.name.text); else localOther.set(d.name.text, d);
      }
    }
    if (ts.isClassDeclaration(st) && st.name) localOther.set(st.name.text, st);
    if (ts.isFunctionDeclaration(st) && st.name && !hasModifier(st, ts.SyntaxKind.AsyncKeyword)) localOther.set(st.name.text, st);
  }
  const okInit = (init: ts.Expression): boolean => {
    const e = unwrap(init);
    if (isAsyncFn(e)) return true;
    return ts.isCallExpression(e) && e.arguments.some((a) => isAsyncFn(unwrap(a)));
  };
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(st, ts.SyntaxKind.DefaultKeyword)) out.push(`export default ${st.name?.text ?? 'function'} (default exports are not allowed)`);
      else if (!hasModifier(st, ts.SyntaxKind.AsyncKeyword)) out.push(`export function ${st.name?.text} is not async`);
    } else if (ts.isVariableStatement(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      for (const d of st.declarationList.declarations) {
        const name = d.name.getText(sf);
        if (!d.initializer || !okInit(d.initializer)) out.push(`export ${st.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'let'} ${name} is not an async function`);
      }
    } else if (ts.isClassDeclaration(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      out.push(`export class ${st.name?.text ?? ''} is not allowed`);
    } else if (ts.isExportAssignment(st)) {
      out.push('export default <expression> is not allowed');
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
      if (!st.exportClause) out.push('export * re-exports cannot be verified');
      else if (ts.isNamespaceExport(st.exportClause)) out.push(`export * as ${st.exportClause.name.text} is not allowed`);
      else for (const el of st.exportClause.elements) {
        if (el.isTypeOnly) continue;
        const local = (el.propertyName ?? el.name).text;
        if (st.moduleSpecifier) out.push(`export { ${local} } from '...' re-export cannot be verified as async`);
        else if (!localAsyncFns.has(local) && localOther.has(local)) out.push(`export { ${local} } is not an async function`);
        else if (!localAsyncFns.has(local)) out.push(`export { ${local} } cannot be verified as an async function (type-only exports must use 'export type')`);
      }
    }
  }
  return out;
}

describe("'use server' files export only async functions", () => {
  const files = walk(ACTIONS_DIR);

  it('finds the actions directory', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no export of a non-function (except allowlisted pre-existing ones)', () => {
    const problems: string[] = [];
    for (const file of files) {
      const rel = path.relative(ACTIONS_DIR, file);
      const allowed = ALLOWLIST[rel] ?? [];
      for (const v of findUseServerViolations(fs.readFileSync(file, 'utf8'), file)) {
        if (!allowed.some((name) => v.includes(` ${name} `) || v.includes(` ${name}`))) problems.push(`${rel}: ${v}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    for (const [rel, names] of Object.entries(ALLOWLIST)) {
      const found = findUseServerViolations(fs.readFileSync(path.join(ACTIONS_DIR, rel), 'utf8'), rel);
      for (const n of names) expect(found.some((v) => v.includes(n)), `${rel} ${n} is no longer a violation`).toBe(true);
    }
  });

  describe('detector', () => {
    const wrap = (body: string) => `'use server';\n${body}`;
    it.each([
      ['export const N = 50;', 1],
      ['export const O = { a: 1 };', 1],
      ['export let L = 1;', 1],
      ['export const f = () => 1;', 1],
      ['export function g() {}', 1],
      ['export class C {}', 1],
      ['const v = 1; export { v };', 1],
      ['export default async function h() {}', 1],
      ['export const s = makeSchema();', 1],
      ['export * from "./x";', 1],
      ['export async function ok() {}', 0],
      ['export const ok2 = async () => 1;', 0],
      ['export const ok3 = withAuth(async (u) => 1);', 0],
      ['export type T = string; export interface I { a: 1 }', 0],
      ['async function a() {} export { a };', 0],
      ['export type { X } from "./x";', 0],
    ])('%s -> %i violation(s)', (src, count) => {
      expect(findUseServerViolations(wrap(src))).toHaveLength(count);
    });
    it('ignores files that are not use server', () => {
      expect(findUseServerViolations('export const N = 50;')).toEqual([]);
    });
  });
});
