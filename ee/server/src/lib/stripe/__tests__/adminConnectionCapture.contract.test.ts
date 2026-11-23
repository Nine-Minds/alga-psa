import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Contract: nothing may hold the result of `getAdminConnection()` beyond one operation.
 *
 * `getAdminConnection()` (packages/db/src/lib/admin.ts) owns the cache and, after a connection-reset
 * wave, destroys its pool and builds a new one. A Knex captured in a class property, a module
 * variable or a closure keeps pointing at the destroyed pool until the process restarts (incident
 * 2026-11-22, alga-2026-0003404: the offer catalog went silently `catalog_unavailable`). Resolve the
 * connection per operation instead; per-call locals are fine.
 *
 * The detector follows the value syntactically (no type checker): through await / parens / `.then`
 * chains / `??`, `||`, `?:` / object and array literals / constructor-style calls
 * (`new X(...)`, `createX(...)`, `makeX(...)`, `buildX(...)`, `Promise.resolve|all|...`), and through a
 * local variable the value is bound to, until it reaches a sink.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const ADMIN_MODULE = 'packages/db/src/lib/admin.ts';

export interface Capture { line: number; reason: string }

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);
const PASS_THROUGH_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);
const PROMISE_PASS_THROUGH = /^Promise\.(resolve|all|allSettled|race|any)$/;
const HOLDER_FACTORY = /^(?:[\w$.]+\.)?(create|make|build|new)[A-Z_]/;

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let current = node.parent; current; current = current.parent) if (ts.isFunctionLike(current)) return current;
  return undefined;
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) if (current === ancestor) return true;
  return false;
}

function bindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) { into.add(name.text); return; }
  for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, into);
}

function declaredNames(scope: ts.Node): Set<string> {
  const names = new Set<string>();
  if (ts.isFunctionLike(scope)) {
    for (const parameter of scope.parameters) bindingNames(parameter.name, names);
    if ((ts.isFunctionExpression(scope)) && scope.name) names.add(scope.name.text);
  }
  if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)) {
    for (const statement of scope.statements) {
      if (ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach((d) => bindingNames(d.name, names));
      else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.add(statement.name.text);
      else if (ts.isImportDeclaration(statement) && statement.importClause) {
        const clause = statement.importClause;
        if (clause.name) names.add(clause.name.text);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
        else if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach((e) => names.add(e.name.text));
      }
    }
  }
  if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer)) {
    scope.initializer.declarations.forEach((d) => bindingNames(d.name, names));
  }
  if (ts.isCatchClause(scope) && scope.variableDeclaration) bindingNames(scope.variableDeclaration.name, names);
  return names;
}

/** The nearest ancestor that declares `name`; undefined when nothing in the file does (a global). */
function declaringScope(identifier: ts.Identifier): ts.Node | undefined {
  for (let current = identifier.parent; current; current = current.parent) {
    if (declaredNames(current).has(identifier.text)) return current;
  }
  return undefined;
}

function calleeText(call: ts.CallExpression): string {
  return call.expression.getText();
}

function captures(source: string, fileName: string): Capture[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Capture[] = [];
  const reported = new Set<string>();
  const tracked = new Set<ts.Node>();

  const report = (origin: ts.Node, reason: string) => {
    const line = sf.getLineAndCharacterOfPosition(origin.getStart(sf)).line + 1;
    const key = `${line}:${reason}`;
    if (!reported.has(key)) { reported.add(key); found.push({ line, reason }); }
  };

  /** Classify where `target` (the left side of an assignment) lives relative to the function doing the assignment. */
  const checkAssignmentTarget = (target: ts.Expression, assignment: ts.Node, origin: ts.Node) => {
    let base: ts.Expression = target;
    let viaMember = false;
    while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base) || ts.isParenthesizedExpression(base) || ts.isNonNullExpression(base)) {
      if (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) viaMember = true;
      base = base.expression;
    }
    if (base.kind === ts.SyntaxKind.ThisKeyword) {
      report(origin, 'admin connection assigned to a class property (resolve per operation instead)');
      return;
    }
    if (!ts.isIdentifier(base)) return;
    const scope = declaringScope(base);
    const fn = enclosingFunction(assignment);
    if (!scope || ts.isSourceFile(scope)) {
      report(origin, `admin connection held in module-scope variable '${base.text}'`);
    } else if (!fn || !isWithin(scope, fn)) {
      report(origin, `admin connection assigned into '${viaMember ? target.getText() : base.text}', declared outside the enclosing function (closure memoisation)`);
    }
  };

  /** Follow a value-carrying expression up to wherever it ends up. */
  const follow = (origin: ts.Node, start: ts.Node) => {
    let current: ts.Node = start;
    for (;;) {
      const parent: ts.Node | undefined = current.parent;
      if (!parent) return;
      if (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent) || ts.isAsExpression(parent)
        || ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isSatisfiesExpression(parent)
        || ts.isArrayLiteralExpression(parent) || ts.isSpreadElement(parent)) { current = parent; continue; }
      if (ts.isBinaryExpression(parent)) {
        const operator = parent.operatorToken.kind;
        if (ASSIGNMENT_OPERATORS.has(operator)) {
          if (parent.right === current) checkAssignmentTarget(parent.left, parent, origin);
          return;
        }
        if (PASS_THROUGH_OPERATORS.has(operator) || (operator === ts.SyntaxKind.CommaToken && parent.right === current)) { current = parent; continue; }
        return;
      }
      if (ts.isConditionalExpression(parent)) {
        if (parent.condition === current) return;
        current = parent; continue;
      }
      if (ts.isPropertyAssignment(parent) && parent.initializer === current) { current = parent.parent; continue; }
      if (ts.isShorthandPropertyAssignment(parent)) { current = parent.parent; continue; }
      if (ts.isSpreadAssignment(parent)) { current = parent.parent; continue; }
      if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
        const call = parent.parent;
        if (['then', 'catch', 'finally'].includes(parent.name.text) && ts.isCallExpression(call) && call.expression === parent) {
          for (const argument of call.arguments) {
            if (ts.isFunctionLike(argument) && argument.parameters[0] && ts.isIdentifier(argument.parameters[0].name)) {
              trackLocal(origin, argument.parameters[0].name, argument);
            }
          }
          current = call; continue;
        }
        return; // reading a member off the pool derives a different value
      }
      if (ts.isNewExpression(parent) || ts.isCallExpression(parent)) {
        if (parent.expression === current) return;
        if (ts.isNewExpression(parent) || PROMISE_PASS_THROUGH.test(calleeText(parent)) || HOLDER_FACTORY.test(calleeText(parent))) { current = parent; continue; }
        return;
      }
      if (ts.isPropertyDeclaration(parent) && parent.initializer === current) {
        report(origin, 'admin connection used to initialise a class property (resolve per operation instead)');
        return;
      }
      if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
        if (!ts.isIdentifier(parent.name)) return; // destructured: a derived value
        const statement = parent.parent.parent;
        if (ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent)) {
          report(origin, `admin connection held in module-scope variable '${parent.name.text}'`);
        } else if (statement.parent) {
          trackLocal(origin, parent.name, statement.parent);
        }
        return;
      }
      return;
    }
  };

  /** A per-call local is fine; follow every later use of it to see whether it escapes into storage. */
  const trackLocal = (origin: ts.Node, name: ts.Identifier, within: ts.Node) => {
    if (tracked.has(name)) return;
    tracked.add(name);
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === name.text && node !== name) {
        const parent = node.parent;
        const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isBindingElement(parent) && parent.propertyName === node);
        if (!isPropertyName && !(ts.isVariableDeclaration(parent) && parent.name === node) && !ts.isParameter(parent)) follow(origin, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(within);
  };

  const visitCalls = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
      if (name === 'getAdminConnection') follow(node, node);
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sf);
  return found.sort((a, b) => a.line - b.line);
}

export function findAdminConnectionCaptures(source: string, fileName = 'fixture.ts'): Capture[] {
  return captures(source, fileName);
}

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '.next' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

function scannedRoots(): string[] {
  const roots = ['ee/server/src', 'server/src'].map((p) => path.join(REPO_ROOT, p));
  for (const group of ['packages', 'ee/packages']) {
    const base = path.join(REPO_ROOT, group);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) if (entry.isDirectory()) roots.push(path.join(base, entry.name, 'src'));
  }
  return roots;
}

describe('getAdminConnection() result is never captured beyond one operation', () => {
  describe('detector fixtures', () => {
    const reasons = (source: string) => findAdminConnectionCaptures(source).map((c) => c.reason);

    it('(a) flags class property initialisers and assignments, awaited or not, including .then', () => {
      expect(reasons(`class S { private p = getAdminConnection(); }`)).toHaveLength(1);
      expect(reasons(`class S { db: any; async init() { this.db = await getAdminConnection(); } }`)).toHaveLength(1);
      expect(reasons(`class S { db: any; init() { this.db = getAdminConnection(); } }`)).toHaveLength(1);
      expect(reasons(`class S { db: any; init() { this.db = getAdminConnection().then((k) => k); } }`)).toHaveLength(1);
      expect(reasons(`class S { db: any; async init() { const { getAdminConnection } = await import('@alga-psa/db/admin'); this.db = await getAdminConnection(); } }`)).toHaveLength(1);
      expect(reasons(`class S { db: any; async init() { const pool = await getAdminConnection(); this.db = pool; } }`)).toHaveLength(1);
      expect(reasons(`class S { async init() { (await import('x')).getAdminConnection().then((k) => { this.db = k; }); } }`)).toHaveLength(1);
    });

    it('(b) flags module-scope variables, including module-level ??= and ||=', () => {
      expect(reasons(`const pool = await getAdminConnection();`)).toHaveLength(1);
      expect(reasons(`const pool = getAdminConnection();`)).toHaveLength(1);
      expect(reasons(`let pool: any; export async function f() { pool ??= await getAdminConnection(); return pool; }`)).toHaveLength(1);
      expect(reasons(`let pool: any; export async function f() { pool ||= await getAdminConnection(); return pool; }`)).toHaveLength(1);
      expect(reasons(`let pool: any; export async function f() { pool = await getAdminConnection(); }`)).toHaveLength(1);
      expect(reasons(`let pool: any; export async function f() { const c = await getAdminConnection(); pool = c; }`)).toHaveLength(1);
    });

    it('(c) flags assignment into a variable declared outside the enclosing function', () => {
      expect(reasons(`function make() { let knexPromise: any = null; const getKnex = () => (knexPromise ??= getAdminConnection()); return getKnex; }`)).toHaveLength(1);
      expect(reasons(`function make(o: any) { let knexPromise: any; const getKnex = () => (knexPromise ??= o.knex ? Promise.resolve(o.knex) : getAdminConnection()); return getKnex; }`)).toHaveLength(1);
      expect(reasons(`class S { inst: any; async get() { if (!this.inst) { this.inst = createCatalog({ db: await getAdminConnection() }); } return this.inst; } }`)).toHaveLength(1);
      expect(reasons(`let inst: any; export async function get() { inst ??= createCatalog({ db: await getAdminConnection(), x: 1 }); return inst; }`)).toHaveLength(1);
      expect(reasons(`function outer() { let held: any; async function inner() { held = await getAdminConnection(); } return inner; }`)).toHaveLength(1);
      expect(reasons(`function outer() { const cache: any = {}; return async () => { cache.db = await getAdminConnection(); }; }`)).toHaveLength(1);
    });

    it('allows per-call locals that are used and dropped', () => {
      expect(reasons(`async function f() { const db = await getAdminConnection(); return db('t').first(); }`)).toEqual([]);
      expect(reasons(`async function f() { let knex: any = null; knex = await getAdminConnection(); return knex; }`)).toEqual([]);
      expect(reasons(`async function f(c?: any) { try { let knex = c; if (!knex) { knex = await getAdminConnection(); } return knex; } catch { return null; } }`)).toEqual([]);
      expect(reasons(`async function f() { const { client } = await getAdminConnection(); return client; }`)).toEqual([]);
      expect(reasons(`async function f() { return createDeps({ db: await getAdminConnection() }); }`)).toEqual([]);
      expect(reasons(`async function f() { const deps = { db: await getAdminConnection(), stripe }; return run(deps); }`)).toEqual([]);
      expect(reasons(`const getDb = () => getAdminConnection(); export const other = async () => (await getDb())('t');`)).toEqual([]);
      expect(reasons(`class S { async f() { const db = await getAdminConnection(); this.count = await countRows(db); } }`)).toEqual([]);
      expect(reasons(`class S { resolve = async () => getAdminConnection(); }`)).toEqual([]);
      expect(reasons(`async function f() { const r: any = {}; r.db = await getAdminConnection(); return r; }`)).toEqual([]);
    });

    it('reports the line of the getAdminConnection() call', () => {
      expect(findAdminConnectionCaptures(`\n\nclass S {\n  db = getAdminConnection();\n}`)).toEqual([expect.objectContaining({ line: 4 })]);
    });
  });

  it('no production source holds an admin connection in a property, module variable or closure', () => {
    const failures: string[] = [];
    let scanned = 0;
    for (const root of scannedRoots()) {
      for (const file of sourceFiles(root)) {
        const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        if (relative === ADMIN_MODULE) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (!text.includes('getAdminConnection')) continue;
        scanned += 1;
        for (const capture of captures(text, file)) failures.push(`${relative}:${capture.line} ${capture.reason}`);
      }
    }
    expect(scanned, 'scanner found no files that use getAdminConnection; roots are wrong').toBeGreaterThan(10);
    expect(failures, `getAdminConnection() results must be resolved per operation, never held:\n${failures.join('\n')}`).toEqual([]);
  });
});
