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

// Follow builder factories rather than treating the factory's first argument as a table.
// The same analysis handles local helpers, imported helpers and class table methods.
const sourceCache = new Map<string, ts.SourceFile>();
const repositoryRoot = path.resolve(__dirname, '../../../../..');

type BoundExpression = { expression: ts.Expression; bindings: Bindings };
type Bindings = Map<ts.Node, BoundExpression>;
type BuilderOrigin = { table: ts.Expression; bindings: Bindings; connection: string; guarded: boolean };

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
  return expression;
}

function importedSource(specifier: string, from: ts.SourceFile): ts.SourceFile | undefined {
  let target: string;
  if (specifier.startsWith('.')) target = path.resolve(path.dirname(from.fileName), specifier);
  else if (specifier.startsWith('@alga-psa/')) {
    const [pkg, ...rest] = specifier.slice('@alga-psa/'.length).split('/');
    const base = [path.join(repositoryRoot, 'packages', pkg), path.join(repositoryRoot, 'ee/packages', pkg), path.join(repositoryRoot, pkg)].find((p) => fs.existsSync(path.join(p, 'package.json')));
    if (!base) return;
    const manifest = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
    const entry = manifest.exports?.[rest.length ? `./${rest.join('/')}` : '.'];
    const source = typeof entry === 'string' ? entry : entry?.types ?? entry?.import;
    target = source ? path.resolve(base, source) : path.join(base, 'src', ...rest);
    if (target.includes('/dist/')) target = target.replace('/dist/', '/src/').replace(/\.js$/, '.ts');
    if (![target, `${target}.ts`, path.join(target, 'index.ts')].some((p) => fs.existsSync(p))) target = path.join(base, fs.existsSync(path.join(base, 'src')) ? 'src' : '', ...rest);
  } else if (specifier.startsWith('@shared/')) target = path.join(repositoryRoot, 'shared', specifier.slice(8));
  else return;
  const file = [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!file) return;
  if (!sourceCache.has(file)) sourceCache.set(file, ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true));
  return sourceCache.get(file);
}

function declaration(name: string, at: ts.Node, seen = new Set<string>()): ts.Node | undefined {
  let scope: ts.Node | undefined = at;
  while (scope) {
    if (ts.isFunctionLike(scope)) {
      const parameter = scope.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
      if (parameter) return parameter;
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const item of [...scope.statements].reverse()) {
        if (ts.isVariableStatement(item) && item.pos <= at.pos) {
          const variable = item.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name);
          if (variable) return variable;
        }
        if (ts.isFunctionDeclaration(item) && item.name?.text === name) return item;
        if (ts.isImportDeclaration(item) && ts.isStringLiteral(item.moduleSpecifier)) {
          const imports = item.importClause?.namedBindings;
          if (imports && ts.isNamedImports(imports)) {
            const imported = imports.elements.find((e) => e.name.text === name);
            if (imported) {
              const module = importedSource(item.moduleSpecifier.text, item.getSourceFile());
              const key = `${module?.fileName}:${name}`;
              if (!module || seen.has(key)) return;
              seen.add(key);
              return declaration(imported.propertyName?.text ?? name, module.endOfFileToken, seen);
            }
          }
        }
        if (ts.isExportDeclaration(item) && !item.exportClause && item.moduleSpecifier && ts.isStringLiteral(item.moduleSpecifier)) {
          const module = importedSource(item.moduleSpecifier.text, item.getSourceFile());
          const key = `${module?.fileName}:${name}`;
          if (module && !seen.has(key)) {
            seen.add(key);
            const found = declaration(name, module.endOfFileToken, seen);
            if (found) return found;
          }
        }
        // Re-exported factories are common package entry points.
        if (ts.isExportDeclaration(item) && item.moduleSpecifier && ts.isStringLiteral(item.moduleSpecifier) && item.exportClause && ts.isNamedExports(item.exportClause)) {
          const exported = item.exportClause.elements.find((e) => e.name.text === name);
          const module = exported && importedSource(item.moduleSpecifier.text, item.getSourceFile());
          const key = `${module?.fileName}:${name}`;
          if (module && exported && !seen.has(key)) {
            seen.add(key);
            return declaration(exported.propertyName?.text ?? name, module.endOfFileToken, seen);
          }
        }
      }
    }
    scope = scope.parent;
  }
}

function classMember(expression: ts.PropertyAccessExpression): ts.ClassElement | undefined {
  if (expression.expression.kind !== ts.SyntaxKind.ThisKeyword) return;
  let parent: ts.Node | undefined = expression;
  while (parent && !ts.isClassDeclaration(parent) && !ts.isClassExpression(parent)) parent = parent.parent;
  return parent?.members.find((m) => m.name?.getText() === expression.name.text);
}

function isConnectionProperty(expression: ts.PropertyAccessExpression): boolean {
  const member = classMember(expression);
  if (member && ts.isPropertyDeclaration(member)) return /\bKnex\b/.test(member.type?.getText() ?? '');
  if (expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
    let owner: ts.Node | undefined = expression;
    while (owner && !ts.isClassDeclaration(owner)) owner = owner.parent;
    if (owner && ts.isClassDeclaration(owner)) {
      const constructor = owner.members.find(ts.isConstructorDeclaration);
      return !!constructor?.parameters.some((p) => p.name.getText() === expression.name.text && /\bKnex\b/.test(p.type?.getText() ?? ''));
    }
  }
  return false;
}

export function findUnguardedWriteSites(source: string, file: string): Site[] {
  const tree = ts.createSourceFile(path.resolve(repositoryRoot, file), source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: Site[] = [];
  const isTarget = (name: string) => tables.has(name) || name.startsWith('co_manag');
  const resolve = (input: ts.Expression, bindings: Bindings, seen = new Set<ts.Node>()): string | undefined => {
    const expr = unwrap(input);
    if (seen.has(expr)) return;
    seen.add(expr);
    if (ts.isStringLiteralLike(expr)) return expr.text.split(/\s+as\s+/i)[0];
    const decl = ts.isIdentifier(expr) ? declaration(expr.text, expr) : ts.isPropertyAccessExpression(expr) ? classMember(expr) : undefined;
    if (!decl) return;
    const bound = bindings.get(decl);
    if (bound) return resolve(bound.expression, bound.bindings, seen);
    if ((ts.isVariableDeclaration(decl) || ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) && decl.initializer) return resolve(decl.initializer, bindings, seen);
  };
  const isFacade = (input: ts.Expression, bindings: Bindings, seen = new Set<ts.Node>()): boolean => {
    const expr = unwrap(input);
    if (seen.has(expr)) return false;
    seen.add(expr);
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'tenantDb') return true;
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      const method = ts.isPropertyAccessExpression(callee) ? classMember(callee) : undefined;
      if (method && ts.isMethodDeclaration(method) && method.body) {
        const returned = method.body.statements.find(ts.isReturnStatement)?.expression;
        return !!returned && isFacade(returned, bindings, seen);
      }
    }
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
      const owner = declaration(expr.expression.text, expr);
      if (owner && ts.isParameter(owner) && owner.type && ts.isTypeLiteralNode(owner.type)) {
        return owner.type.members.some((m) => ts.isPropertySignature(m) && m.name.getText() === expr.name.text && m.type?.getText() === 'TenantDb');
      }
    }
    if (!ts.isIdentifier(expr)) return false;
    const decl = declaration(expr.text, expr);
    if (!decl) return false;
    const bound = bindings.get(decl);
    if (bound) return isFacade(bound.expression, bound.bindings, seen);
    if (ts.isParameter(decl) && decl.type?.getText() === 'TenantDb') return true;
    return ts.isVariableDeclaration(decl) && !!decl.initializer && isFacade(decl.initializer, bindings, seen);
  };
  const origin = (input: ts.Expression, bindings: Bindings, seen = new Set<ts.Node>()): BuilderOrigin | undefined => {
    const expr = unwrap(input);
    if (seen.has(expr)) return;
    seen.add(expr);
    if (ts.isIdentifier(expr)) {
      const decl = declaration(expr.text, expr);
      if (!decl) return;
      const bound = bindings.get(decl);
      if (bound) return origin(bound.expression, bound.bindings, seen);
      if (ts.isVariableDeclaration(decl) && decl.initializer) return origin(decl.initializer, bindings, seen);
      return;
    }
    if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'builder') return origin(expr.expression, bindings, seen);
    if (!ts.isCallExpression(expr)) return;
    const callee = expr.expression;
    const decl = ts.isIdentifier(callee) ? declaration(callee.text, callee) : ts.isPropertyAccessExpression(callee) ? classMember(callee) : undefined;
    if (decl && ts.isParameter(decl) && decl.type && ts.isFunctionTypeNode(decl.type) && decl.type.type.getText().includes('QueryBuilder') && expr.arguments[0]) {
      return origin(expr.arguments[0], bindings, seen);
    }
    const fn = decl && ts.isVariableDeclaration(decl) && decl.initializer ? unwrap(decl.initializer) : decl;
    if (fn && (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) && fn.body) {
      const inner = new Map(bindings);
      fn.parameters.forEach((parameter, index) => {
        if (expr.arguments[index]) inner.set(parameter, { expression: expr.arguments[index], bindings });
      });
      const returns: ts.Expression[] = [];
      const collect = (node: ts.Node) => {
        if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression);
        else if (node === fn.body || !ts.isFunctionLike(node)) ts.forEachChild(node, collect);
      };
      if (ts.isBlock(fn.body)) collect(fn.body); else returns.push(fn.body);
      const origins = returns.map((value) => origin(value, inner, new Set(seen))).filter((value): value is BuilderOrigin => !!value);
      if (origins.length) return origins.find((value) => !value.guarded) ?? origins[0];
      return;
    }
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === 'table' || callee.name.text === 'parentScopedTable' || callee.name.text === 'scoped') {
        if (!expr.arguments[0]) return;
        return { table: expr.arguments[0], bindings, connection: callee.expression.getText(), guarded: isFacade(callee.expression, bindings) };
      }
      const receiver = origin(callee.expression, bindings, seen);
      if (receiver) return receiver;
      // A Knex connection can itself be a property (this.knex, context.db).
      // Fluent query methods above retain the origin of their receiver.
      if (expr.arguments[0] && !ts.isCallExpression(callee.expression) && (isConnectionProperty(callee) || isTarget(resolve(expr.arguments[0], bindings) ?? ''))) {
        return { table: expr.arguments[0], bindings, connection: callee.getText(), guarded: false };
      }
      return;
    }
    if (ts.isIdentifier(callee) && expr.arguments[0]) return { table: expr.arguments[0], bindings, connection: callee.text, guarded: false };
  };
  const statement = (node: ts.Node): ts.Statement | undefined => {
    while (node.parent && !ts.isStatement(node)) node = node.parent;
    return ts.isStatement(node) ? node : undefined;
  };
  const admitted = (node: ts.Node, table: ts.Expression, name: string | undefined, connection: string) => {
    const stmt = statement(node);
    const parent = stmt?.parent;
    if (!stmt || !parent || (!ts.isBlock(parent) && !ts.isSourceFile(parent))) return false;
    const previous = parent.statements[parent.statements.indexOf(stmt) - 1];
    if (!previous || !ts.isExpressionStatement(previous) || !ts.isAwaitExpression(previous.expression)) return false;
    const call = previous.expression.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !call.arguments.length || call.arguments[0].getText() !== connection) return false;
    if (call.expression.text === 'admitWrite' || call.expression.text === 'admitTenantWrite') return true;
    if (call.expression.text !== 'admitOperationalWrite' || call.arguments.length < 3 || (name?.startsWith('co_manag') && !tables.has(name))) return false;
    return call.arguments[2].getText() === table.getText() || (!!name && resolve(call.arguments[2], new Map()) === name);
  };
  const lines = source.split('\n');
  const report = (node: ts.Node, value: BuilderOrigin, kind: Site['kind'], rawTable?: string) => {
    const name = rawTable ?? resolve(value.table, value.bindings);
    if ((value.guarded && (!name?.startsWith('co_manag') || tables.has(name))) || (name && !isTarget(name))) return;
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
    if (EXEMPT.test(lines.slice(Math.max(0, line - 2), line + 1).join('\n')) || admitted(node, value.table, name, value.connection)) return;
    sites.push({ file, line: line + 1, table: name ?? `unresolved: ${value.table.getText()}`, kind });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && WRITE_CALLS.has(node.expression.name.text)) {
      const value = origin(node.expression.expression, new Map());
      if (value) report(node, value, 'bare-builder');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'raw' && node.arguments.length) {
      const arg = node.arguments[0];
      if (ts.isStringLiteralLike(arg) || ts.isTemplateExpression(arg)) {
        const hit = RAW_SQL.exec(arg.getText(tree));
        if (hit && isTarget(hit[1])) report(node, { table: arg, bindings: new Map(), connection: node.expression.expression.getText(), guarded: false }, 'raw-sql', hit[1]);
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
    // The exemption belongs on or above the write's first line; a trailer on a later continuation line is not read.
    expect(findUnguardedWriteSites(`await trx('co_managed_relationships').insert({\n  a: 1,\n  b: 2 }); // write-admission: exempt — trailer`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await admitOperationalWrite(trx, t, 'tickets', 'x');\nawait trx.raw('UPDATE tickets SET a = 1');`, 'x.ts')).toHaveLength(0);
    expect(findUnguardedWriteSites(`await admitOperationalWrite(trx, t, 'assets', 'x');\nawait trx.raw('UPDATE tickets SET a = 1');`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await tenantDb(trx, t).table('tickets').update({});`, 'x.ts')).toHaveLength(0);
  });

  it('follows helper returns and lexical bindings without exempting raw helpers', () => {
    expect(findUnguardedWriteSites(`const db = tenantDb(trx, tenant); const table = (name: string) => db.table(name); await table('tickets').update({});`, 'x.ts')).toEqual([]);
    expect(findUnguardedWriteSites(`function table(conn, name) { return conn(name); } await table(trx, 'tickets').update({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`const query = trx('tickets'); await query.update({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await this.knex('co_managed_relationships').update({});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`const query = tenantDb(trx, t).table('tickets'); await query.update({});`, 'x.ts')).toEqual([]);
    expect(findUnguardedWriteSites(`function write(db: TenantDb) { return db.table('tickets').update({}); }`, 'x.ts')).toEqual([]);
    expect(findUnguardedWriteSites(`function write(db: any) { return db.table('tickets').update({}); }`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`class Model { tableName = 'tickets'; write(db) { return db(this.tableName).update({}); } }`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await admitWrite(trx, {tenant: t, operation: 'relationship'}); await trx('co_managed_relationships').insert({});`, 'x.ts')).toEqual([]);
    // co_manag tables are not on the native positive list: a facade alone cannot admit them.
    expect(findUnguardedWriteSites(`await tenantDb(trx, t).table('co_managed_relationships').insert({});`, 'x.ts')).toHaveLength(1);
  });

  it('no unannotated raw-SQL or bare-builder write reaches an operational table', async () => {
    const files = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(path.resolve(__dirname, '../../../../', root)));
    const sites: Site[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      sites.push(...findUnguardedWriteSites(fs.readFileSync(file, 'utf8'), path.relative(path.resolve(__dirname, '../../../../..'), file)));
      if (i % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const report = sites.map((s) => `${s.file}:${s.line} [${s.kind}] ${s.table}`);
    expect(report, `Add "// write-admission: exempt — <reason>" or route through tenantDb:\n${report.join('\n')}`).toEqual([]);
  }, 180_000);

  it('no exemption on an operational table claims to be "NOT covered" at runtime', () => {
    const offenders = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(path.resolve(__dirname, '../../../../', root)))
      .filter((file) => /write-admission:\s*exempt[^\n]*NOT covered/i.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(path.resolve(__dirname, '../../../../..'), file));
    expect(offenders).toEqual([]);
  });
});
