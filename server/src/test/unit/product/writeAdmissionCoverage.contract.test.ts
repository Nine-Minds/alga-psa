import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { OPERATIONAL_WRITE_TABLES, RETAINED_COMMAND_TABLES } from '@alga-psa/db';

/**
 * A6: write-admission coverage.
 *
 * Every native write to an operational table must pass the tenantDb terminal guard (or the
 * BaseService mutationGuard). The guard sits on tenantDb builders, so the ways to slip past it
 * are the ones that do not use tenantDb: a bare `trx('table')` / `knex('table')` builder, or raw
 * SQL. This scan finds those on operational tables. A site that is correct to bypass carries
 *
 *     // write-admission: exempt — <reason>
 *
 * on the line above (or the same line). A reason is mandatory. A write is also covered when an
 * explicit `await admitOperationalWrite(db, tenant, table, operation)` immediately precedes it,
 * which is how raw SQL and bare builders are admitted without rewriting them.
 */

const SOURCE_ROOTS = ['src', '../ee/server/src', '../ee/packages', '../packages', '../shared', '../services', '../ee/temporal-workflows/src'];
const SKIP_DIRS = new Set(['test-utils', 'node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '__tests__', '__mocks__', 'test', 'tests', 'migrations', 'seeds', 'testing']);
const SKIP_FILES = [/\.(test|spec)\.(t|j)sx?$/, /\.d\.ts$/, /\.generated\.ts$/, /\.stories\.(t|j)sx?$/, /\.contract\.test\./];

const EXEMPT = /write-admission:\s*exempt\s*[—-]\s*\S+/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(path.join(dir, entry.name), out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !SKIP_FILES.some((re) => re.test(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const tables = new Set(Object.keys(OPERATIONAL_WRITE_TABLES));
const WRITE_CALLS = new Set(['insert', 'update', 'del', 'delete', 'truncate', 'increment', 'decrement']);
const RAW_SQL = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(?:public\.)?([a-z_][a-z0-9_]*)/i;

export interface Site { file: string; line: number; table: string; kind: 'raw-sql' | 'bare-builder' }

export function findUnguardedWriteSites(source: string, file: string): Site[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: Site[] = [];
  const seen = new Set<number>();
  const tenantHelpers = new Set<string>();
  const findTenantHelpers = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body?.statements.length === 1) {
      const stmt = node.body.statements[0];
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        let value = stmt.expression;
        while (ts.isAsExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression;
        if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === 'table') {
          const root = value.expression.expression;
          if (ts.isCallExpression(root) && ts.isIdentifier(root.expression) && root.expression.text === 'tenantDb') tenantHelpers.add(node.name.text);
        }
      }
    }
    ts.forEachChild(node, findTenantHelpers);
  };
  findTenantHelpers(tree);
  const isTarget = (name: string) => tables.has(name) || name.startsWith('co_manag');
  const resolve = (expr: ts.Expression): string | undefined => {
    if (ts.isStringLiteralLike(expr)) return expr.text.split(/\s+as\s+/i)[0];
    if (!ts.isIdentifier(expr)) return undefined;
    let candidate: string | undefined;
    let ambiguous = false;
    const find = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expr.text && node.initializer && ts.isStringLiteralLike(node.initializer)) {
        if (candidate !== undefined && candidate !== node.initializer.text) ambiguous = true;
        candidate = node.initializer.text;
      }
      ts.forEachChild(node, find);
    };
    find(tree);
    return ambiguous ? undefined : candidate;
  };
  const statement = (node: ts.Node): ts.Statement | undefined => {
    while (node.parent && !ts.isStatement(node)) node = node.parent;
    return ts.isStatement(node) ? node : undefined;
  };
  const isTenantFacade = (name: string, node: ts.Node): boolean => {
    let scope: ts.Node | undefined = node;
    while (scope) {
      if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
        const declarations = scope.statements.filter((item) => item.pos < node.pos && ts.isVariableStatement(item));
        for (const item of declarations.reverse()) {
          if (!ts.isVariableStatement(item)) continue;
          for (const decl of item.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === name) {
              return !!decl.initializer && ts.isCallExpression(decl.initializer) && ts.isIdentifier(decl.initializer.expression) && decl.initializer.expression.text === 'tenantDb';
            }
          }
        }
      }
      scope = scope.parent;
    }
    return false;
  };
  const admitted = (node: ts.Node, tableExpr: ts.Expression, table: string | undefined, connection: string) => {
    const stmt = statement(node);
    const parent = stmt?.parent;
    if (!stmt || !parent || (!ts.isBlock(parent) && !ts.isSourceFile(parent))) return false;
    const previous = parent.statements[parent.statements.indexOf(stmt) - 1];
    if (!previous || !ts.isExpressionStatement(previous) || !ts.isAwaitExpression(previous.expression)) return false;
    const call = previous.expression.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'admitOperationalWrite' || call.arguments.length < 3) return false;
    if (call.arguments[0].getText(tree) !== connection || table?.startsWith('co_manag')) return false;
    const arg = call.arguments[2];
    return arg.getText(tree) === tableExpr.getText(tree) || (!!table && resolve(arg) === table);
  };
  const report = (node: ts.Node, expr: ts.Expression, table: string | undefined, connection: string, kind: Site['kind']) => {
    if (table && !isTarget(table)) return;
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
    const lines = source.split('\n');
    const near = lines.slice(Math.max(0, line - 2), line + 1).join('\n');
    if (EXEMPT.test(near) || admitted(node, expr, table, connection) || seen.has(node.pos)) return;
    seen.add(node.pos);
    sites.push({ file, line: line + 1, table: table ?? `unresolved: ${expr.getText(tree)}`, kind });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && WRITE_CALLS.has(node.expression.name.text)) {
      let root: ts.Expression = node.expression.expression;
      while (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression) && root.expression.name.text !== 'table') root = root.expression.expression;
      if (ts.isCallExpression(root) && root.arguments.length) {
        const callee = root.expression;
        const connection = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && callee.name.text === 'table' ? callee.expression.getText(tree) : undefined;
        if (connection && connection !== 'tenantDb' && !tenantHelpers.has(connection) && !connection.includes('tenantDb(') && !isTenantFacade(connection, node)) report(node, root.arguments[0], resolve(root.arguments[0]), connection, 'bare-builder');
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'raw' && node.arguments.length) {
      const arg = node.arguments[0];
      if (ts.isStringLiteralLike(arg) || ts.isTemplateExpression(arg)) {
        const sql = arg.getText(tree);
        const hit = RAW_SQL.exec(sql);
        if (hit && isTarget(hit[1])) report(node, arg, hit[1], node.expression.expression.getText(tree), 'raw-sql');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return sites;
}

describe('write-admission coverage (A6)', () => {
  it('lists the retained-command surfaces among the operational tables so they fail closed', () => {
    expect(Object.keys(OPERATIONAL_WRITE_TABLES)).toEqual(expect.arrayContaining([
      'schedule_entries', 'appointment_requests', 'online_meetings', 'comments', 'kb_articles',
    ]));
    expect(RETAINED_COMMAND_TABLES.length).toBeGreaterThan(0);
    for (const [name, entry] of Object.entries(OPERATIONAL_WRITE_TABLES)) {
      expect(entry.reason, `${name} needs a reason`).toMatch(/\S/);
    }
  });

  it('the scanner recognises the shapes it is meant to catch', () => {
    expect(findUnguardedWriteSites(`await trx('tickets').where({a:1}).update({b:2});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx.raw('UPDATE tickets SET a = 1');`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx('co_managed_relationships').insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx.table('co_managed_relationships').insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await connection('co_managed_relationships').insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx('co_managed_relationships')\n.where({})\n.where({})\n.where({})\n.where({})\n.where({})\n.where({})\n.where({})\n.where({})\n.insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`const tableName = 'tickets'; await trx(tableName).update({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await connection(unknownTable).update({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx.raw('UPDATE co_managed_relationships SET a = 1');`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await admitOperationalWrite(trx, t, 'co_managed_relationships', 'x');\nawait trx('co_managed_relationships').insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx(cfg.table).insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx(config.table).delete();`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`if (condition) { await admitOperationalWrite(trx, t, 'tickets', 'x'); }\nawait trx('tickets').insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`if (condition) await admitOperationalWrite(trx, t, 'tickets', 'x');\nawait trx('tickets').insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`if (condition)\n  await admitOperationalWrite(trx, t, 'tickets', 'x');\nawait trx('tickets').insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await admitOperationalWrite(other, t, 'tickets', 'x');\nawait trx('tickets').insert({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx('tickets').where({a:1}).first();`, 'x.ts')).toHaveLength(0);
    expect(findUnguardedWriteSites(`// write-admission: exempt — system job\nawait trx('tickets').insert({});`, 'x.ts')).toHaveLength(0);
    expect(findUnguardedWriteSites(`await admitOperationalWrite(trx, t, 'tickets', 'x');\nawait trx.raw('UPDATE tickets SET a = 1');`, 'x.ts')).toHaveLength(0);
    expect(findUnguardedWriteSites(`await admitOperationalWrite(trx, t, 'assets', 'x');\nawait trx.raw('UPDATE tickets SET a = 1');`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await tenantDb(trx, t).table('tickets').update({});`, 'x.ts')).toHaveLength(0);
  });

  it('no unannotated raw-SQL or bare-builder write reaches an operational table', () => {
    const sites = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(path.resolve(__dirname, '../../../../', root)))
      .flatMap((file) => findUnguardedWriteSites(fs.readFileSync(file, 'utf8'), path.relative(path.resolve(__dirname, '../../../../..'), file)));
    const report = sites.map((s) => `${s.file}:${s.line} [${s.kind}] ${s.table}`);
    expect(report, `Add "// write-admission: exempt — <reason>" or route through tenantDb:\n${report.join('\n')}`).toEqual([]);
  });

  it('no exemption on an operational table claims to be "NOT covered" at runtime', () => {
    const offenders = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(path.resolve(__dirname, '../../../../', root)))
      .filter((file) => /write-admission:\s*exempt[^\n]*NOT covered/i.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(path.resolve(__dirname, '../../../../..'), file));
    expect(offenders).toEqual([]);
  });
});
