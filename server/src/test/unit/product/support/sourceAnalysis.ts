import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Shared source analysis for the AST contract tests in this directory
 * (write-admission, read coverage, permission coverage).
 *
 * What lives here is the part that is the same for every contract:
 *
 *   - the source walk (`SOURCE_ROOTS`, `collectSourceFiles`)
 *   - import resolution, including `@alga-psa/*` workspace packages (`Program.importedSource`)
 *   - lexical declaration lookup that follows imports and re-exports (`Program.declaration`)
 *   - finding exported server actions and REST handlers (`findEntries`)
 *   - "which tables does this function touch, and which callee names does it reach,
 *     transitively through helpers, methods and imports" (`createAnalyzer().summarize`)
 *
 * LEVERAGE: pattern ast-source-walk — the write-admission contract keeps its own copy of importedSource/declaration/the source walk;
 * it was left untouched (identical results are the point of that test) and should move onto this module in its own change.
 *
 * What a contract decides (which tables matter, which callee names satisfy it) stays in the contract.
 *
 * KNOWN LIMITATIONS (heuristic gaps, never silent passes in the contracts' own comments):
 *   - Table names are string literals, `const` strings or class-field strings. A table name computed at
 *     run time is counted in `dynamicTables` and is not attributed to any table.
 *   - Raw SQL is read only where the text is visible: a string or template literal passed to `raw`,
 *     `whereRaw`, `joinRaw`, `selectRaw`, `fromRaw` or `query`. SQL assembled elsewhere is not seen.
 *   - A method call on a value whose class the walker cannot determine (an injected `any`, a value
 *     returned by a factory call, an interface-typed field with no initialiser) is not followed. Its
 *     name is still recorded as a callee. A class is determined from `this`, `this.field`, a variable
 *     initialised with `new T()`, a typed parameter or field, or a class name used statically.
 *   - A query builder stored in a variable and written to later (`const q = trx('t'); q.insert(...)`)
 *     is counted as a read of `t`.
 *   - Callee names are collected from the whole reachable closure, so a check that exists on only one
 *     branch of a helper still counts. The contracts are lenient in that direction on purpose.
 */

export const SOURCE_ROOTS = ['src', '../ee/server/src', '../ee/packages', '../packages', '../shared', '../services', '../ee/temporal-workflows/src'];
export const SKIP_DIRS = new Set(['test-utils', 'node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '__tests__', '__mocks__', 'test', 'tests', 'migrations', 'seeds', 'testing']);
export const SKIP_FILES = [/\.(test|spec)\.(t|j)sx?$/, /\.d\.ts$/, /\.generated\.ts$/, /\.stories\.(t|j)sx?$/, /\.contract\.test\./];

/** `server/` directory, as the contract tests resolve `SOURCE_ROOTS` against it. */
export const serverRoot = path.resolve(__dirname, '../../../../..');
export const repositoryRoot = path.resolve(serverRoot, '..');

export function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(path.join(dir, entry.name), out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !SKIP_FILES.some((re) => re.test(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

export function allSourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) => collectSourceFiles(path.resolve(serverRoot, root))).sort();
}

export function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
  return expression;
}

export function classMember(expression: ts.PropertyAccessExpression): ts.ClassElement | undefined {
  if (expression.expression.kind !== ts.SyntaxKind.ThisKeyword) return;
  let parent: ts.Node | undefined = expression;
  while (parent && !ts.isClassDeclaration(parent) && !ts.isClassExpression(parent)) parent = parent.parent;
  return parent?.members.find((m) => m.name?.getText() === expression.name.text);
}

/**
 * A program is a lazily-parsed set of source files. `virtualFiles` overlays real files, which is how the
 * fixture tests run the analysis on synthetic sources without writing them anywhere the real walk looks.
 */
export class Program {
  private cache = new Map<string, ts.SourceFile>();
  constructor(private readonly virtualFiles: Readonly<Record<string, string>> = {}) {}

  isFile(file: string): boolean {
    return file in this.virtualFiles || (fs.existsSync(file) && fs.statSync(file).isFile());
  }

  source(file: string, text?: string): ts.SourceFile {
    const cached = this.cache.get(file);
    if (cached && text === undefined) return cached;
    const content = text ?? this.virtualFiles[file] ?? fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    this.cache.set(file, tree);
    return tree;
  }

  importedSource(specifier: string, from: ts.SourceFile): ts.SourceFile | undefined {
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
    else if (specifier.startsWith('@/')) target = path.join(serverRoot, 'src', specifier.slice(2));
    else return;
    const file = [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts')].find((p) => this.isFile(p));
    return file ? this.source(file) : undefined;
  }

  /** The declaration `name` refers to at `at`: a parameter, variable, function, class, or one of those behind an import. */
  declaration(name: string, at: ts.Node, seen = new Set<string>()): ts.Node | undefined {
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
          if ((ts.isFunctionDeclaration(item) || ts.isClassDeclaration(item)) && item.name?.text === name) return item;
          if (ts.isImportDeclaration(item) && ts.isStringLiteral(item.moduleSpecifier)) {
            const clause = item.importClause;
            const imports = clause?.namedBindings;
            const specifier = item.moduleSpecifier.text;
            let imported: string | undefined;
            if (clause?.name?.text === name) imported = 'default';
            else if (imports && ts.isNamedImports(imports)) {
              const element = imports.elements.find((e) => e.name.text === name);
              if (element) imported = element.propertyName?.text ?? name;
            } else if (imports && ts.isNamespaceImport(imports) && imports.name.text === name) return item;
            if (imported) {
              const module = this.importedSource(specifier, item.getSourceFile());
              const key = `${module?.fileName}:${imported}`;
              if (!module || seen.has(key)) return;
              seen.add(key);
              return imported === 'default' ? this.defaultExport(module, seen) : this.declaration(imported, module.endOfFileToken, seen);
            }
          }
          if (ts.isExportDeclaration(item) && !item.exportClause && item.moduleSpecifier && ts.isStringLiteral(item.moduleSpecifier)) {
            const module = this.importedSource(item.moduleSpecifier.text, item.getSourceFile());
            const key = `${module?.fileName}:${name}`;
            if (module && !seen.has(key)) {
              seen.add(key);
              const found = this.declaration(name, module.endOfFileToken, seen);
              if (found) return found;
            }
          }
          // Re-exported factories are common package entry points.
          if (ts.isExportDeclaration(item) && item.moduleSpecifier && ts.isStringLiteral(item.moduleSpecifier) && item.exportClause && ts.isNamedExports(item.exportClause)) {
            const exported = item.exportClause.elements.find((e) => e.name.text === name);
            const module = exported && this.importedSource(item.moduleSpecifier.text, item.getSourceFile());
            const key = `${module?.fileName}:${name}`;
            if (module && exported && !seen.has(key)) {
              seen.add(key);
              return this.declaration(exported.propertyName?.text ?? name, module.endOfFileToken, seen);
            }
          }
        }
      }
      scope = scope.parent;
    }
  }

  private defaultExport(module: ts.SourceFile, seen: Set<string>): ts.Node | undefined {
    for (const item of module.statements) {
      if ((ts.isFunctionDeclaration(item) || ts.isClassDeclaration(item)) && item.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return item;
      if (ts.isExportAssignment(item) && ts.isIdentifier(item.expression)) return this.declaration(item.expression.text, module.endOfFileToken, seen);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Entries: exported server actions and REST handlers
// ---------------------------------------------------------------------------------------------

export type EntryKind = 'server-action' | 'controller-method' | 'route-handler';

/** A body the analysis can walk, with the class context `this` resolves against. */
export interface Unit {
  node: ts.Node;
  /** The class that lexically contains `node`, when it is a member. */
  ownerClass?: ts.ClassLikeDeclaration;
  /** The most-derived class the call chain started from (dynamic dispatch and inherited `this.service`). */
  entryClass?: ts.ClassLikeDeclaration;
}

export interface Entry {
  /** Repository-relative path. */
  file: string;
  /** `name` for actions and route handlers, `Class.method` for controller methods. */
  export: string;
  kind: EntryKind;
  unit: Unit;
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function hasUseServer(tree: ts.SourceFile): boolean {
  for (const statement of tree.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

const isExported = (node: ts.Node) => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isPublicMember = (member: ts.ClassElement) => !ts.getModifiers(member as ts.HasModifiers)?.some((m) => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(m.kind));

/** Exported value declarations of a module: `[exportedName, declaration-or-initialiser]`. */
function exportedValues(tree: ts.SourceFile): Array<{ name: string; node: ts.Node }> {
  const out: Array<{ name: string; node: ts.Node }> = [];
  for (const statement of tree.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement) && statement.name && statement.body) out.push({ name: statement.name.text, node: statement });
    else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) out.push({ name: declaration.name.text, node: declaration.initializer });
      }
    }
  }
  return out;
}

const isFunctionValue = (node: ts.Node) => ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isCallExpression(node);

export function findEntries(tree: ts.SourceFile, file: string): Entry[] {
  const entries: Entry[] = [];
  const normalized = file.split(path.sep).join('/');
  if (hasUseServer(tree)) {
    for (const { name, node } of exportedValues(tree)) {
      if (isFunctionValue(node)) entries.push({ file, export: name, kind: 'server-action', unit: { node } });
    }
  }
  if (/(^|\/)app\/api\/.*\/route\.tsx?$/.test(normalized)) {
    for (const { name, node } of exportedValues(tree)) {
      if (HTTP_METHODS.has(name)) entries.push({ file, export: name, kind: 'route-handler', unit: { node } });
    }
  }
  if (/\/api\/controllers\/[^/]*Controller\.tsx?$/.test(normalized)) {
    for (const statement of tree.statements) {
      if (!ts.isClassDeclaration(statement) || !isExported(statement) || !statement.name) continue;
      for (const member of statement.members) {
        if (!isPublicMember(member) || !member.name || ts.isConstructorDeclaration(member)) continue;
        const name = member.name.getText();
        if (ts.isMethodDeclaration(member) && member.body) entries.push({ file, export: `${statement.name.text}.${name}`, kind: 'controller-method', unit: { node: member, ownerClass: statement, entryClass: statement } });
        else if (ts.isPropertyDeclaration(member) && member.initializer && isFunctionValue(unwrap(member.initializer))) entries.push({ file, export: `${statement.name.text}.${name}`, kind: 'controller-method', unit: { node: member.initializer, ownerClass: statement, entryClass: statement } });
      }
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Summaries: tables touched and callee names reached
// ---------------------------------------------------------------------------------------------

export interface Summary {
  /** Manifest tables read (a builder chain with no write terminal, or SQL `FROM`/`JOIN`). */
  reads: ReadonlySet<string>;
  /** Manifest tables read or written. */
  touches: ReadonlySet<string>;
  /** Every callee name in the reachable closure (identifier calls and property-call names). */
  callees: ReadonlySet<string>;
  /** Connection-style calls whose table name could not be resolved. A heuristic gap, not a pass. */
  dynamicTables: number;
}

export interface AnalyzerOptions {
  program: Program;
  /** Is this a table worth recording (the contract passes the tenant manifest). */
  isTable(name: string): boolean;
  /**
   * Files the walk does not descend into: authentication and authorization infrastructure, whose own
   * table reads (sessions, roles) say nothing about what the caller does with tenant data. The names
   * of calls made *into* them are still recorded.
   */
  opaqueFile?(file: string): boolean;
}

const BUILDER_METHODS = new Set(['table', 'from', 'join', 'leftJoin', 'rightJoin', 'innerJoin', 'fullOuterJoin', 'crossJoin', 'leftOuterJoin', 'rightOuterJoin', 'into', 'scoped', 'parentScopedTable']);
/** Names a Knex connection or transaction is bound to (`trx`, `knex`, `this.db`, `tenantTrx`, `readDb`, ...), and the facade's `table`. */
const CONNECTION_NAME = /(?:^|[a-z])(?:knex|trx|tx|db|conn|connection|transaction|database|table)$/i;
const WRITE_METHODS = new Set(['insert', 'update', 'del', 'delete', 'truncate', 'increment', 'decrement']);
const RAW_METHODS = new Set(['raw', 'whereRaw', 'joinRaw', 'selectRaw', 'fromRaw', 'havingRaw', 'orderByRaw', 'query']);
const SQL_WRITE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
const SQL_READ = /\b(?:FROM|JOIN)\s+"?(?:public\.)?([a-z_][a-z0-9_]*)/gi;

const baseName = (name: string) => name.split(/\s+as\s+/i)[0].trim().replace(/^"?public"?\./, '').replace(/"/g, '').split(/\s+/)[0];

interface Facts { reads: Set<string>; touches: Set<string>; callees: Set<string>; dynamicTables: number; targets: Unit[] }

export function createAnalyzer(options: AnalyzerOptions) {
  const { program, isTable } = options;
  const opaque = options.opaqueFile ?? (() => false);
  const factCache = new Map<string, Facts>();
  const nodeIds = new Map<ts.Node, number>();
  const id = (node: ts.Node) => nodeIds.get(node) ?? (nodeIds.set(node, nodeIds.size), nodeIds.size - 1);
  const keyOf = (unit: Unit) => `${id(unit.node)}:${unit.entryClass ? id(unit.entryClass) : ''}`;

  const classOfNode = (node: ts.Node): ts.ClassLikeDeclaration | undefined => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isClassDeclaration(current) && !ts.isClassExpression(current)) current = current.parent;
    return current;
  };

  const superClass = (cls: ts.ClassLikeDeclaration): ts.ClassLikeDeclaration | undefined => {
    const heritage = cls.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
    if (!heritage || !ts.isIdentifier(heritage)) return;
    const found = program.declaration(heritage.text, cls);
    return found && (ts.isClassDeclaration(found) || ts.isClassExpression(found)) ? found : undefined;
  };

  const classChain = (cls: ts.ClassLikeDeclaration): ts.ClassLikeDeclaration[] => {
    const chain: ts.ClassLikeDeclaration[] = [];
    for (let current: ts.ClassLikeDeclaration | undefined = cls; current && !chain.includes(current); current = superClass(current)) chain.push(current);
    return chain;
  };

  const findMember = (cls: ts.ClassLikeDeclaration, name: string): ts.ClassElement | undefined => {
    for (const candidate of classChain(cls)) {
      const member = candidate.members.find((m) => m.name?.getText() === name && !ts.isConstructorDeclaration(m));
      if (member) return member;
    }
  };

  const constructorParameter = (cls: ts.ClassLikeDeclaration, name: string): ts.ParameterDeclaration | undefined => {
    for (const candidate of classChain(cls)) {
      const constructor = candidate.members.find(ts.isConstructorDeclaration);
      const parameter = constructor?.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
      if (parameter) return parameter;
    }
  };

  const classByTypeName = (type: ts.TypeNode | undefined, at: ts.Node): ts.ClassLikeDeclaration | undefined => {
    if (!type || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return;
    const found = program.declaration(type.typeName.text, at);
    return found && ts.isClassDeclaration(found) ? found : undefined;
  };

  const classOfNew = (expression: ts.Expression): ts.ClassLikeDeclaration | undefined => {
    const value = unwrap(expression);
    if (!ts.isNewExpression(value) || !ts.isIdentifier(value.expression)) return;
    const found = program.declaration(value.expression.text, value);
    return found && ts.isClassDeclaration(found) ? found : undefined;
  };

  /** Classes whose methods a receiver expression can dispatch to. */
  const classesOf = (receiver: ts.Expression, unit: Unit, depth = 0): ts.ClassLikeDeclaration[] => {
    const expr = unwrap(receiver);
    if (depth > 4) return [];
    const self = unit.entryClass ?? unit.ownerClass;
    if (expr.kind === ts.SyntaxKind.ThisKeyword) return self ? [self] : [];
    if (ts.isNewExpression(expr)) return [classOfNew(expr)].filter((c): c is ts.ClassLikeDeclaration => !!c);
    if (ts.isIdentifier(expr)) {
      const decl = program.declaration(expr.text, expr);
      if (!decl) return [];
      if (ts.isClassDeclaration(decl)) return [decl];
      if (ts.isVariableDeclaration(decl)) {
        const cls = (decl.initializer && classOfNew(decl.initializer)) || classByTypeName(decl.type, decl);
        return cls ? [cls] : [];
      }
      if (ts.isParameter(decl)) {
        const cls = classByTypeName(decl.type, decl);
        return cls ? [cls] : [];
      }
      return [];
    }
    if (ts.isPropertyAccessExpression(expr) && unwrap(expr.expression).kind === ts.SyntaxKind.ThisKeyword && self) {
      const name = expr.name.text;
      const out = new Set<ts.ClassLikeDeclaration>();
      for (const candidate of classChain(self)) {
        const member = candidate.members.find((m) => m.name?.getText() === name);
        if (member && ts.isPropertyDeclaration(member)) {
          const cls = classByTypeName(member.type, member) ?? (member.initializer && classOfNew(member.initializer));
          if (cls) out.add(cls);
        }
        const parameter = constructorParameter(candidate, name);
        if (parameter) {
          const cls = classByTypeName(parameter.type, parameter);
          if (cls) out.add(cls);
        }
      }
      // A base controller's `this.service` is typed by the base class; the concrete controller is
      // what decides which service(s) it holds, so every service-typed field of the concrete chain counts.
      if (unit.entryClass && unit.ownerClass && unit.entryClass !== unit.ownerClass) {
        for (const candidate of classChain(unit.entryClass)) {
          for (const member of candidate.members) {
            if (!ts.isPropertyDeclaration(member)) continue;
            const cls = classByTypeName(member.type, member);
            if (cls && /Service$/.test(cls.name?.text ?? '')) out.add(cls);
          }
        }
      }
      return [...out];
    }
    return [];
  };

  const memberUnit = (member: ts.ClassElement, entryClass: ts.ClassLikeDeclaration | undefined): Unit | undefined => {
    const owner = classOfNode(member);
    if (ts.isMethodDeclaration(member) && member.body) return { node: member, ownerClass: owner, entryClass };
    if (ts.isGetAccessorDeclaration(member) && member.body) return { node: member, ownerClass: owner, entryClass };
    if (ts.isPropertyDeclaration(member) && member.initializer && isFunctionValue(unwrap(member.initializer))) return { node: member.initializer, ownerClass: owner, entryClass };
  };

  const unitOfDeclaration = (decl: ts.Node | undefined, entryClass?: ts.ClassLikeDeclaration): Unit[] => {
    if (!decl) return [];
    if (ts.isFunctionDeclaration(decl) && decl.body) return [{ node: decl }];
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const value = unwrap(decl.initializer);
      if (isFunctionValue(value)) return [{ node: value }];
    }
    if (ts.isClassDeclaration(decl)) {
      const constructor = decl.members.find(ts.isConstructorDeclaration);
      return constructor?.body ? [{ node: constructor, ownerClass: decl, entryClass: entryClass ?? decl }] : [];
    }
    return [];
  };

  /** A string a table argument resolves to, when it is statically visible. */
  const constString = (input: ts.Expression, unit: Unit, depth = 0): string | undefined => {
    const expr = unwrap(input);
    if (depth > 4) return;
    if (ts.isStringLiteralLike(expr)) return expr.text;
    if (ts.isIdentifier(expr)) {
      const decl = program.declaration(expr.text, expr);
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) return constString(decl.initializer, unit, depth + 1);
      return;
    }
    if (ts.isPropertyAccessExpression(expr) && unwrap(expr.expression).kind === ts.SyntaxKind.ThisKeyword) {
      const self = unit.entryClass ?? unit.ownerClass;
      const member = self && findMember(self, expr.name.text);
      if (member && ts.isPropertyDeclaration(member) && member.initializer) return constString(member.initializer, unit, depth + 1);
    }
  };

  const chainMethods = (call: ts.Node): string[] => {
    const names: string[] = [];
    let current: ts.Node = call;
    for (;;) {
      let parent: ts.Node | undefined = current.parent;
      while (parent && (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent) || ts.isNonNullExpression(parent) || ts.isAsExpression(parent))) { current = parent; parent = parent.parent; }
      if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current && parent.parent && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
        names.push(parent.name.text);
        current = parent.parent;
      } else return names;
    }
  };

  const importedName = (callee: ts.Identifier): string | undefined => {
    for (const item of callee.getSourceFile().statements) {
      const bindings = ts.isImportDeclaration(item) ? item.importClause?.namedBindings : undefined;
      const element = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((e) => e.name.text === callee.text && e.propertyName) : undefined;
      if (element) return element.propertyName!.text;
    }
  };

  const unitName = (unit: Unit): string => {
    const node = unit.node;
    const owner = unit.ownerClass?.name?.text;
    if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
    if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node))) return `${owner ?? ''}${owner ? '.' : ''}${ts.isConstructorDeclaration(node) ? 'constructor' : node.name.getText()}`;
    const parent = node.parent;
    if (parent && (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name) return `${owner ? `${owner}.` : ''}${parent.name.getText()}`;
    return '(anonymous)';
  };

  const factsOf = (unit: Unit): Facts => {
    const key = keyOf(unit);
    const cached = factCache.get(key);
    if (cached) return cached;
    const facts: Facts = { reads: new Set(), touches: new Set(), callees: new Set(), dynamicTables: 0, targets: [] };
    factCache.set(key, facts);
    const tableRef = (name: string, write: boolean) => {
      const table = baseName(name);
      if (!isTable(table)) return false;
      facts.touches.add(table);
      if (!write) facts.reads.add(table);
      return true;
    };
    const addTarget = (target: Unit | undefined) => { if (target && !opaque(target.node.getSourceFile().fileName)) facts.targets.push(target); };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = unwrap(node.expression);
        const args = node.arguments ?? [];
        if (ts.isIdentifier(callee)) {
          facts.callees.add(callee.text);
          // `import { getClientIdFromPortalUser as getClientIdFromUser }`: the contracts name the exported function.
          const original = importedName(callee);
          if (original) facts.callees.add(original);
        } else if (ts.isPropertyAccessExpression(callee)) facts.callees.add(callee.name.text);
        if (ts.isCallExpression(node)) {
          const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
          const connectionLike = (ts.isIdentifier(callee) && CONNECTION_NAME.test(callee.text))
            || (method !== undefined && (BUILDER_METHODS.has(method) || CONNECTION_NAME.test(method)));
          if (connectionLike && args[0]) {
            const name = constString(args[0], unit);
            const write = chainMethods(node).some((m) => WRITE_METHODS.has(m));
            if (name !== undefined) tableRef(name, write);
            else if (method !== undefined && BUILDER_METHODS.has(method)) facts.dynamicTables++;
          }
          if (method && RAW_METHODS.has(method) && args[0] && (ts.isStringLiteralLike(args[0]) || ts.isTemplateExpression(args[0]))) {
            const text = args[0].getText();
            const written = new Set<string>();
            for (const hit of text.matchAll(SQL_WRITE)) { tableRef(hit[1].toLowerCase(), true); written.add(hit[0]); }
            // `DELETE FROM x` is a write, not also a read of x.
            const readText = text.replace(/\bDELETE\s+FROM\b/gi, 'DELETE');
            for (const hit of readText.matchAll(SQL_READ)) tableRef(hit[1].toLowerCase(), false);
          }
          // Direct dispatch: identifier call, this.method, receiver.method, namespace.function
          if (ts.isIdentifier(callee)) {
            const decl = program.declaration(callee.text, callee);
            unitOfDeclaration(decl, unit.entryClass).forEach(addTarget);
          } else if (ts.isPropertyAccessExpression(callee)) {
            const receiver = unwrap(callee.expression);
            if (receiver.kind === ts.SyntaxKind.SuperKeyword) {
              const owner = unit.ownerClass && superClass(unit.ownerClass);
              const member = owner && findMember(owner, callee.name.text);
              addTarget(member ? memberUnit(member, unit.entryClass) : undefined);
            } else {
              for (const cls of classesOf(receiver, unit)) {
                const member = findMember(cls, callee.name.text);
                addTarget(member ? memberUnit(member, unit.entryClass && classChain(unit.entryClass).includes(cls) ? unit.entryClass : cls) : undefined);
              }
              if (ts.isIdentifier(receiver)) {
                const decl = program.declaration(receiver.text, receiver);
                if (decl && ts.isImportDeclaration(decl) && decl.moduleSpecifier && ts.isStringLiteral(decl.moduleSpecifier)) {
                  const module = program.importedSource(decl.moduleSpecifier.text, decl.getSourceFile());
                  if (module) unitOfDeclaration(program.declaration(callee.name.text, module.endOfFileToken)).forEach(addTarget);
                }
              }
            }
          }
          // Callbacks and handlers passed by name.
          for (const arg of args) {
            const value = unwrap(arg);
            if (ts.isIdentifier(value)) unitOfDeclaration(program.declaration(value.text, value)).filter((u) => !ts.isClassDeclaration(u.node)).forEach(addTarget);
          }
        } else if (ts.isNewExpression(node) && ts.isIdentifier(callee)) {
          const decl = program.declaration(callee.text, callee);
          if (decl && ts.isClassDeclaration(decl)) unitOfDeclaration(decl).forEach(addTarget);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(unit.node);
    return facts;
  };

  // Tarjan over the call graph: each strongly connected component shares one summary, so cycles are exact.
  const summaries = new Map<string, Summary>();
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: Array<{ key: string; unit: Unit }> = [];
  const members = new Map<string, Unit>();
  let counter = 0;

  const merge = (into: { reads: Set<string>; touches: Set<string>; callees: Set<string>; dynamicTables: number }, from: { reads: ReadonlySet<string>; touches: ReadonlySet<string>; callees: ReadonlySet<string>; dynamicTables: number }) => {
    from.reads.forEach((v) => into.reads.add(v));
    from.touches.forEach((v) => into.touches.add(v));
    from.callees.forEach((v) => into.callees.add(v));
    into.dynamicTables += from.dynamicTables;
  };

  const strongConnect = (unit: Unit): void => {
    const key = keyOf(unit);
    members.set(key, unit);
    index.set(key, counter);
    low.set(key, counter);
    counter++;
    stack.push({ key, unit });
    onStack.add(key);
    const facts = factsOf(unit);
    for (const target of facts.targets) {
      const targetKey = keyOf(target);
      if (summaries.has(targetKey)) continue;
      if (!index.has(targetKey)) {
        strongConnect(target);
        low.set(key, Math.min(low.get(key)!, low.get(targetKey)!));
      } else if (onStack.has(targetKey)) low.set(key, Math.min(low.get(key)!, index.get(targetKey)!));
    }
    if (low.get(key) === index.get(key)) {
      const component: Array<{ key: string; unit: Unit }> = [];
      for (;;) {
        const top = stack.pop()!;
        onStack.delete(top.key);
        component.push(top);
        if (top.key === key) break;
      }
      const combined = { reads: new Set<string>(), touches: new Set<string>(), callees: new Set<string>(), dynamicTables: 0 };
      const inside = new Set(component.map((c) => c.key));
      for (const { unit: member } of component) {
        const memberFacts = factsOf(member);
        merge(combined, memberFacts);
        for (const target of memberFacts.targets) {
          const targetKey = keyOf(target);
          const done = summaries.get(targetKey);
          if (done && !inside.has(targetKey)) merge(combined, done);
        }
      }
      for (const { key: memberKey } of component) summaries.set(memberKey, combined);
    }
  };

  return {
    /** Direct call targets of a unit (one hop), for callers that need to know what an entry delegates to. */
    targetsOf: (unit: Unit): Unit[] => factsOf(unit).targets,
    /**
     * Where a fact comes from, for human-readable pin reasons: `'directly'` when the unit's own body
     * satisfies `has`, otherwise the name of the first direct callee (in source order) whose closure does.
     */
    via(unit: Unit, has: (facts: { reads: ReadonlySet<string>; touches: ReadonlySet<string>; callees: ReadonlySet<string> }) => boolean): string | undefined {
      if (has(factsOf(unit))) return 'directly';
      for (const target of factsOf(unit).targets) if (has(this.summarize(target))) return unitName(target);
    },
    summarize(unit: Unit): Summary {
      const key = keyOf(unit);
      if (!summaries.has(key)) strongConnect(unit);
      return summaries.get(key)!;
    },
  };
}

export type Analyzer = ReturnType<typeof createAnalyzer>;

/** True when the closure of `summary` reaches any of `names` by callee name. */
export function reachesAny(summary: Summary, names: ReadonlySet<string>, predicate?: (name: string) => boolean): boolean {
  for (const callee of summary.callees) if (names.has(callee) || predicate?.(callee)) return true;
  return false;
}

/**
 * Entries worth analysing: a route that only delegates to a controller method is represented by that
 * controller method, so it is dropped here rather than listed twice.
 */
export function withoutControllerDelegates(entries: Entry[], analyzer: Analyzer): Entry[] {
  return entries.filter((entry) => {
    if (entry.kind !== 'route-handler') return true;
    return !analyzer.targetsOf(entry.unit).some((target) => /\/api\/controllers\/[^/]*Controller\.tsx?$/.test(target.node.getSourceFile().fileName.split(path.sep).join('/')));
  });
}

export function relativeToRepository(file: string): string {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}
