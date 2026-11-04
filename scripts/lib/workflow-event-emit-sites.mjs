/**
 * Emit-site analysis for workflow events (alga0002106, plan step E).
 *
 * Built on ts-morph and the TypeScript type checker (never grep): every symbol is resolved through
 * import aliases and barrels, and event types are read from the checker's literal types.
 *
 * What it proves about product code (tests, fixtures and generated output are excluded):
 *
 *  1. TYPED PATH. Every catalogued event is published through `publishWorkflowEvent` /
 *     `publishBuiltWorkflowPayload`, whose `payload` is a call to (or a variable initialised from,
 *     or a parameter typed as) a branded builder result. No inline object literal, no `as` cast.
 *  2. REGISTERED BUILDERS. Every `builtWorkflowPayload(...)` call (the only way to mint the brand)
 *     sits inside a function that the emitter contract registry exercises, directly or through
 *     the call graph. A builder nobody registered cannot mint a brand.
 *  3. NO STRING-TYPED ESCAPE ROUTE. `publishEventByName`, `publishWorkflowEventByName` and
 *     `publishCatalogEventPayload` are not called by product code at all.
 *  4. UNTYPED SINKS. Every other way to reach the transport (`EventBus.publish`,
 *     `RedisStreamClient.publishEvent`, the calendar `publishEvent`, the legacy raw publishers
 *     `shared/events/publisher.ts` / `packages/core/src/lib/events/publisher.ts`, and the
 *     level.io sync engine's injected publisher) is only allowed for event types that are NOT in
 *     the workflow catalog. The checker resolves the event type of each call to its literal
 *     members; an unresolvable type or any catalogued member is a violation.
 *  5. KNOWN DEFECT CALLS. `publishUnregisteredEventType` call sites must cite the defect ticket.
 */
import path from 'node:path';
import fs from 'node:fs';
import { Node, Project, SyntaxKind, ts } from 'ts-morph';

/** Cheap pre-filter: text that any emit site (or wrapper/brand mint) must contain. */
const EMIT_SITE_CANDIDATE = /publish|builtWorkflowPayload|BuiltWorkflowPayload|WorkflowCatalog/i;

export const DEFAULT_OPTIONS = {
  catalogFile: 'packages/event-schemas/src/workflowEventCatalog.ts',
  catalogConst: 'WORKFLOW_EVENT_CATALOG',
  tsConfigFilePath: 'tsconfig.base.json',
  contractGlobs: ['server/src/test/unit/workflow-event-contracts/**/*.ts'],
  productGlobs: [
    'packages/*/src/**/*.{ts,tsx}',
    'shared/**/*.{ts,tsx}',
    'server/src/**/*.{ts,tsx}',
    'ee/server/src/**/*.{ts,tsx}',
    'ee/packages/*/src/**/*.{ts,tsx}',
    'ee/temporal-workflows/src/**/*.{ts,tsx}',
    'services/*/src/**/*.{ts,tsx}',
  ],
  excludeGlobs: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next*/**',
    '**/*.d.ts',
    '**/*.test.{ts,tsx}',
    '**/*.spec.{ts,tsx}',
    '**/*.test-d.ts',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/test/**',
    '**/tests/**',
    '**/test-utils/**',
    'server/src/test/**',
    'tools/**',
  ],
  /** Files that legitimately mint brands from a stored (already-built) payload. */
  brandMintAllowedFiles: ['packages/event-schemas/src/builtWorkflowPayload.ts', 'packages/event-bus/src/publishers/index.ts'],
  /** Files that implement the raw transport; their internal raw calls are not emit sites. */
  transportImplementationFiles: [
    'packages/event-bus/src/publishers/index.ts',
    'packages/event-bus/src/eventBus.ts',
    'packages/event-bus/src/index.ts',
    'shared/workflow/streams/redisStreamClient.ts',
    'packages/core/src/lib/events/redisStreamClient.ts',
    'packages/workflow-streams/src/streams/redisStreamClient.ts',
  ],
  /**
   * Untyped wrappers around the raw transport. A wrapper's own raw call is exempt; every CALL of
   * the wrapper is checked instead. `eventTypeProps` are the argument object properties that carry
   * the event type.
   */
  untypedWrappers: [
    { file: 'ee/packages/calendar/src/lib/eventBus/publishers.ts', name: 'publishEvent', eventTypeProps: ['eventType'] },
    { file: 'shared/events/publisher.ts', name: 'publishEvent', eventTypeProps: ['eventType'] },
    { file: 'packages/core/src/lib/events/publisher.ts', name: 'publishEvent', eventTypeProps: ['eventType'] },
  ],
  /**
   * Injected publishers whose events are built by a local helper and published with a cast
   * (`publishEvent(event as never)`). The guard checks the declared event-name type alias.
   */
  castSinks: [
    { file: 'ee/server/src/lib/integrations/levelio/sync/syncEngine.ts', eventNameAlias: 'LevelIoSyncEventName' },
  ],
  defectTicket: 'alga-2026-0002675',
  /** Extra in-memory files (self-test fixtures): { 'relative/path.ts': 'source' }. */
  overlays: {},
  /** When set, only the listed project-relative files are product code (self-test). */
  productFiles: null,
  contractFiles: null,
};

const BY_NAME_BANNED = new Set(['publishEventByName', 'publishWorkflowEventByName', 'publishCatalogEventPayload']);
const TYPED_PUBLISHERS = new Set(['publishWorkflowEvent', 'publishBuiltWorkflowPayload']);
const NON_CATALOG_PUBLISHERS = new Set(['publishNonCatalogWorkflowEvent', 'publishNonCatalogEventByName', 'publishEvent']);
const PUBLISHER_NAMES = new Set([...BY_NAME_BANNED, ...TYPED_PUBLISHERS, ...NON_CATALOG_PUBLISHERS]);

function rel(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += '(?:' + glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end;
    } else if ('.+^$()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchesAny(globs, relPath) {
  return globs.some((g) => globToRegExp(g).test(relPath));
}

function functionKey(node) {
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
}

function isFunctionLike(node) {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isMethodDeclaration(node)
  );
}

/** Declarations that make a symbol "a function we can reach": function decls, methods, `const f = () =>`. */
function callableDeclarations(symbol) {
  if (!symbol) return [];
  let resolved = symbol;
  if (resolved.isAlias?.()) {
    try {
      resolved = resolved.getAliasedSymbol() ?? resolved;
    } catch {
      /* unresolved alias */
    }
  }
  const out = [];
  for (const decl of resolved.getDeclarations()) {
    if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl)) out.push(decl);
    else if (Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) out.push(decl);
    }
  }
  return out;
}

/** Keys of every function-like ancestor, innermost first. A variable-bound arrow keys as its declaration. */
function enclosingFunctionKeys(node) {
  const keys = [];
  for (let cur = node.getParent(); cur; cur = cur.getParent()) {
    if (!isFunctionLike(cur)) continue;
    const parent = cur.getParent();
    if (parent && Node.isVariableDeclaration(parent) && (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur))) {
      keys.push(functionKey(parent));
    } else {
      keys.push(functionKey(cur));
    }
  }
  return keys;
}

function calleeName(call) {
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) return expr.getText();
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  return null;
}

/** Resolved declaration name of a call's callee (follows `import { a as b }` and barrels). */
function resolvedCalleeName(call) {
  const expr = call.getExpression();
  const id = Node.isIdentifier(expr) ? expr : Node.isPropertyAccessExpression(expr) ? expr.getNameNode() : null;
  if (!id) return null;
  const symbol = id.getSymbol();
  if (!symbol) return id.getText();
  let resolved = symbol;
  if (symbol.isAlias?.()) {
    try {
      resolved = symbol.getAliasedSymbol() ?? symbol;
    } catch {
      /* ignore */
    }
  }
  return resolved.getName() === 'default' ? id.getText() : resolved.getName();
}

function unwrap(expr) {
  let cur = expr;
  for (;;) {
    if (Node.isParenthesizedExpression(cur) || Node.isAwaitExpression(cur) || Node.isNonNullExpression(cur)) {
      cur = cur.getExpression();
    } else return cur;
  }
}

function stringLiteralMembers(type) {
  if (type.isStringLiteral()) return [type.getLiteralValue()];
  if (type.isUnion()) {
    const members = [];
    for (const t of type.getUnionTypes()) {
      const m = stringLiteralMembers(t);
      if (m === null) return null;
      members.push(...m);
    }
    return members;
  }
  return null;
}

function objectArg(call, index = 0) {
  const arg = call.getArguments()[index];
  return arg ? unwrap(arg) : undefined;
}

function property(objectLiteral, name) {
  if (!objectLiteral || !Node.isObjectLiteralExpression(objectLiteral)) return undefined;
  return objectLiteral.getProperty(name);
}

function propertyValueNode(prop) {
  if (!prop) return undefined;
  if (Node.isPropertyAssignment(prop)) return prop.getInitializer();
  if (Node.isShorthandPropertyAssignment(prop)) return prop.getNameNode();
  return undefined;
}

/**
 * Resolve the event-type expression of an event object (an object literal's property, or the
 * property type of the argument's checked type) to its literal members. null = not resolvable.
 */
function eventTypesOfEventArg(arg, props) {
  const unwrapped = unwrap(arg);
  for (const name of props) {
    const prop = property(unwrapped, name);
    const valueNode = propertyValueNode(prop);
    if (valueNode) {
      const members = stringLiteralMembers(valueNode.getType());
      if (members) return members;
    }
  }
  // Fall back to the checker's view of the argument type.
  const type = unwrapped.getType();
  for (const name of props) {
    const sym = type.getProperty(name);
    if (!sym) continue;
    const members = stringLiteralMembers(sym.getTypeAtLocation(arg));
    if (members) return members;
  }
  return null;
}

function loadCatalog(project, root, options) {
  const file = project.getSourceFile(path.join(root, options.catalogFile));
  if (!file) throw new Error(`catalog file not found: ${options.catalogFile}`);
  const decl = file.getVariableDeclaration(options.catalogConst);
  if (!decl) throw new Error(`${options.catalogConst} not found in ${options.catalogFile}`);
  const init = unwrap(decl.getInitializerOrThrow());
  let obj = init;
  while (Node.isAsExpression(obj) || Node.isSatisfiesExpression(obj)) obj = unwrap(obj.getExpression());
  if (!Node.isObjectLiteralExpression(obj)) throw new Error(`${options.catalogConst} must be an object literal`);
  const types = new Set();
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop)) types.add(prop.getName().replace(/^['"]|['"]$/g, ''));
  }
  return types;
}

function buildProject(root, options) {
  const tsConfigFilePath = path.join(root, options.tsConfigFilePath);
  // Memory: third-party packages (googleapis, kubernetes client, stripe, next ...) are ~8k of the
  // ~11k program files and the guard never needs their types: payload brands live in repo code.
  // Anything resolving into node_modules (other than zod) is left unresolved, i.e. `any`.
  const resolutionHost = (moduleResolutionHost, getCompilerOptions) => ({
    resolveModuleNames: (moduleNames, containingFile, _reused, _redirected, _opts, _cache) =>
      moduleNames.map((name) => {
        const resolved = ts.resolveModuleName(name, containingFile, getCompilerOptions(), moduleResolutionHost).resolvedModule;
        if (!resolved) return undefined;
        const external = /[\\/]node_modules[\\/]/.test(resolved.resolvedFileName) && !/[\\/]node_modules[\\/]zod[\\/]/.test(resolved.resolvedFileName);
        return external ? undefined : resolved;
      }),
  });
  const project = fs.existsSync(tsConfigFilePath)
    ? new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: false, resolutionHost })
    : new Project({ compilerOptions: { target: ts.ScriptTarget.ES2022, strict: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, skipLibCheck: true } });
  project.compilerOptions.set({ baseUrl: root, noEmit: true, skipLibCheck: true, allowJs: false, incremental: false, types: [], typeRoots: [], lib: ['lib.esnext.d.ts'] });
  return project;
}

function listFiles(root, globs, excludeGlobs, onlyFiles) {
  if (onlyFiles) return onlyFiles.map((f) => path.join(root, f));
  const includeRes = globs.map(globToRegExp);
  const excludeRes = excludeGlobs.map(globToRegExp);
  const out = [];
  const topDirs = new Set(globs.map((g) => g.split('/')[0]));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.next') || entry.name === 'dist' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const r = rel(root, full);
        if (includeRes.some((re) => re.test(r)) && !excludeRes.some((re) => re.test(r))) out.push(full);
      }
    }
  };
  for (const top of topDirs) {
    const dir = path.join(root, top);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

export function analyzeWorkflowEventEmitSites(rootDir, userOptions = {}) {
  const root = path.resolve(rootDir);
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const project = buildProject(root, options);

  // Memory: every product file added as a root drags its whole import graph (React, next, knex...)
  // into the program. A file that never mentions publishing or a brand mint cannot contain an emit
  // site, so only files that do are roots; their imports still resolve through the type checker.
  const productPaths = listFiles(root, options.productGlobs, options.excludeGlobs, options.productFiles).filter((p) =>
    options.productFiles ? true : EMIT_SITE_CANDIDATE.test(fs.readFileSync(p, 'utf8'))
  );
  const contractPaths = listFiles(root, options.contractGlobs, [], options.contractFiles);
  for (const p of new Set([...productPaths, ...contractPaths, path.join(root, options.catalogFile)])) {
    if (fs.existsSync(p)) project.addSourceFileAtPath(p);
  }
  for (const [file, text] of Object.entries(options.overlays ?? {})) {
    project.createSourceFile(path.join(root, file), text, { overwrite: true });
  }
  const overlayPaths = Object.keys(options.overlays ?? {}).map((f) => path.join(root, f));
  const productSet = new Set([...productPaths, ...overlayPaths.filter((p) => !matchesAny(options.contractGlobs, rel(root, p)) )]);
  const productFiles = [...productSet].map((p) => project.getSourceFile(p)).filter(Boolean);
  const contractFiles = [...new Set([...contractPaths, ...overlayPaths.filter((p) => matchesAny(options.contractGlobs, rel(root, p)))])]
    .map((p) => project.getSourceFile(p))
    .filter(Boolean);

  const phase = (n) => { if (process.env.EMIT_GUARD_DEBUG) console.error(`[phase] ${n} heap=${Math.round(process.memoryUsage().heapUsed/1e6)}MB files=${project.getSourceFiles().length}`); };
  phase('roots-added');
  const catalog = loadCatalog(project, root, options);
  phase('catalog');
  const violations = [];
  const violate = (node, code, message) => {
    const sf = node.getSourceFile();
    violations.push({ file: rel(root, sf.getFilePath()), line: node.getStartLineNumber(), code, message });
  };

  // ---- Registered-builder reachability (call graph closure from the contract registry). ----
  // Memory: this closure visits every identifier of every reachable function. It uses the raw
  // compiler nodes, not ts-morph wrappers (wrapping each identifier retained ~6GB on this tree).
  const reachable = new Set();
  const queue = [];
  const rawChecker = project.getTypeChecker().compilerObject;
  if (process.env.EMIT_GUARD_DEBUG) { const fs_ = project.getProgram().compilerObject.getSourceFiles(); const nm = {}; for (const f of fs_) { const m = f.fileName.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); const k = m ? m[1] : 'repo'; nm[k] = (nm[k] || 0) + 1; } console.error('[program]', fs_.length, JSON.stringify(Object.entries(nm).sort((a, b) => b[1] - a[1]).slice(0, 12))); }
  const rawKey = (decl) => `${decl.getSourceFile().fileName}:${decl.getStart()}`;
  const markReference = (identifier) => {
    let symbol = rawChecker.getSymbolAtLocation(identifier);
    if (!symbol) return;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try { symbol = rawChecker.getAliasedSymbol(symbol) ?? symbol; } catch { /* unresolved alias */ }
    }
    for (const decl of symbol.declarations ?? []) {
      const callable =
        ts.isFunctionDeclaration(decl) ||
        ts.isMethodDeclaration(decl) ||
        (ts.isVariableDeclaration(decl) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)));
      if (!callable) continue;
      const key = rawKey(decl);
      if (!reachable.has(key)) {
        reachable.add(key);
        queue.push(ts.isVariableDeclaration(decl) ? decl.initializer : decl);
      }
    }
  };
  const visitIdentifiers = (node) => {
    if (ts.isIdentifier(node)) markReference(node);
    ts.forEachChild(node, visitIdentifiers);
  };
  for (const sf of contractFiles) visitIdentifiers(sf.compilerNode);
  while (queue.length) visitIdentifiers(queue.pop());
  phase('reachability');
  const isRegistered = (node) => enclosingFunctionKeys(node).some((k) => reachable.has(k));

  const hasBrand = (type) =>
    type.getProperties().some((p) => p.getName().includes('builtWorkflowPayloadBrand')) ||
    (type.isUnion() && type.getUnionTypes().length > 0 && type.getUnionTypes().every(hasBrand)) ||
    (type.isIntersection() && type.getIntersectionTypes().some(hasBrand));

  /**
   * The payload expression must carry the brand AND be neither an inline literal nor a cast. The
   * brand can only be minted by `builtWorkflowPayload` (rule 2: only inside registry-exercised
   * builders), so a branded value is, by construction, builder output. A call to a registry-
   * reachable function is accepted without needing the type (e.g. an unresolved external type).
   */
  const isBuiltPayloadExpression = (expr) => {
    const e = unwrap(expr);
    if (Node.isAsExpression(e) || Node.isTypeAssertion(e) || Node.isObjectLiteralExpression(e) || Node.isSatisfiesExpression(e)) return false;
    if (Node.isCallExpression(e)) {
      if (resolvedCalleeName(e) === 'builtWorkflowPayload') return false; // inline mint at the publish site
      const callee = e.getExpression();
      const id = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
      if (callableDeclarations(id.getSymbol?.()).some((d) => reachable.has(functionKey(d)))) return true;
    }
    return hasBrand(e.getType());
  };

  const isTransportImplementation = (relPath) => options.transportImplementationFiles.includes(relPath);

  const callsDeclaredWrapper = (call, name) => {
    const expr = call.getExpression();
    const id = Node.isIdentifier(expr) ? expr : Node.isPropertyAccessExpression(expr) ? expr.getNameNode() : null;
    let symbol = id?.getSymbol();
    if (symbol?.isAlias?.()) {
      try { symbol = symbol.getAliasedSymbol() ?? symbol; } catch { /* ignore */ }
    }
    const files = (symbol?.getDeclarations() ?? []).map((d) => rel(root, d.getSourceFile().getFilePath()));
    return options.untypedWrappers.some((w) => w.name === name && files.includes(w.file));
  };

  // ---- Per call-site rules. ----
  for (const sf of productFiles) {
    const relPath = rel(root, sf.getFilePath());
    const wrapperHere = options.untypedWrappers.filter((w) => w.file === relPath);
    // (6) A publisher referenced anywhere but a direct call (`(publishWorkflowEvent as any)(...)`,
    // `const p = publishEvent`, passed as a callback) would dodge every per-call rule above.
    if (!isTransportImplementation(relPath)) {
      for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
        const text = id.getText();
        if (!PUBLISHER_NAMES.has(text)) continue;
        const parent = id.getParent();
        if (!parent || Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent) || Node.isImportClause(parent)) continue;
        if (Node.isFunctionDeclaration(parent) || Node.isTypeReference(parent) || Node.isTypeQuery(parent)) continue;
        // Declarations, not uses: `const { publishEvent } = await import(...)` and `publishEvent?: ...` members.
        if (Node.isBindingElement(parent) || Node.isPropertySignature(parent)) continue;
        if (options.castSinks?.some((c) => c.file === relPath) || wrapperHere.length > 0) continue;
        if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() !== id) continue;
        const callee = Node.isPropertyAccessExpression(parent) ? parent : id;
        const outer = callee.getParent();
        if (outer && Node.isCallExpression(outer) && outer.getExpression() === callee) continue;
        if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) continue;
        violate(id, 'indirect-publisher-reference', `${text} is referenced other than as a direct call (cast, alias or callback); call it directly so the emit-site rules apply`);
      }
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = resolvedCalleeName(call);
      const localName = calleeName(call);
      if (!name) continue;

      // (3) by-name escape routes
      if (BY_NAME_BANNED.has(name) || BY_NAME_BANNED.has(localName ?? '')) {
        violate(call, 'by-name-publish', `${BY_NAME_BANNED.has(name) ? name : localName}() is a string-typed publish; use the typed publishWorkflowEvent with a registered builder (or publishNonCatalogEventByName for non-catalogued types)`);
        continue;
      }

      // (2) brand minting
      if (name === 'builtWorkflowPayload') {
        if (!options.brandMintAllowedFiles.includes(relPath) && !isRegistered(call)) {
          violate(call, 'unregistered-builder', 'builtWorkflowPayload() is called in a function that the emitter contract registry never exercises; add a registry case for this builder');
        }
        continue;
      }

      // (1) typed path
      if (TYPED_PUBLISHERS.has(name)) {
        if (isTransportImplementation(relPath) && relPath !== 'packages/event-bus/src/publishers/index.ts') continue;
        const arg = objectArg(call);
        if (!arg) {
          violate(call, 'typed-publish-shape', `${name}() is missing its argument`);
          continue;
        }
        let eventTypeNode;
        let payloadNode;
        if (Node.isObjectLiteralExpression(arg)) {
          eventTypeNode = propertyValueNode(property(arg, 'eventType'));
          payloadNode = propertyValueNode(property(arg, 'payload'));
          if (!eventTypeNode || !payloadNode) {
            // `{ ...params }` forwarding: fall back to the argument's checked type below.
            if (!arg.getProperties().some(Node.isSpreadAssignment)) {
              violate(call, 'typed-publish-shape', `${name}() is missing eventType or payload`);
              continue;
            }
          }
        }
        if (eventTypeNode && payloadNode) {
          const members = stringLiteralMembers(eventTypeNode.getType());
          if (members) {
            const stray = members.filter((m) => !catalog.has(m));
            if (stray.length) violate(call, 'non-catalog-typed-publish', `${name}() publishes ${stray.join(', ')}, which is not in the workflow catalog; use publishNonCatalogWorkflowEvent`);
          }
          if (!isBuiltPayloadExpression(payloadNode)) {
            violate(payloadNode, 'unbuilt-payload', `${name}() payload must be the result of a registered builder (inline literals, casts, or unregistered builders are rejected)`);
          }
        } else {
          // Forwarded params object (wrapper / spread): trust the checked types, which require the brand.
          const payloadSym = arg.getType().getProperty('payload');
          const payloadType = payloadSym?.getTypeAtLocation(arg);
          if (!payloadType || !hasBrand(payloadType)) {
            violate(call, 'unbuilt-payload', `${name}() forwarded argument's payload type does not carry the BuiltWorkflowPayload brand`);
          }
        }
        continue;
      }

      // (5) known-defect publishes
      if (name === 'publishUnregisteredEventType') {
        const stmt = call.getFirstAncestor((a) => Node.isStatement(a)) ?? call;
        const text = stmt.getLeadingCommentRanges().map((r) => r.getText()).join('\n') + '\n' + call.getLeadingCommentRanges().map((r) => r.getText()).join('\n');
        const above = sf.getFullText().slice(Math.max(0, stmt.getStart() - 600), stmt.getStart());
        if (!text.includes(options.defectTicket) && !above.includes(options.defectTicket)) {
          violate(call, 'uncited-defect-publish', `publishUnregisteredEventType() must cite ${options.defectTicket} in a comment directly above the call`);
        }
        continue;
      }

      // (4a) non-catalog publishers must not carry catalogued types
      if (NON_CATALOG_PUBLISHERS.has(name) && Node.isIdentifier(call.getExpression()) && !wrapperHere.some((w) => w.name === name) && !callsDeclaredWrapper(call, name)) {
        const arg = call.getArguments()[0];
        if (!arg) continue;
        const members = eventTypesOfEventArg(arg, ['eventType']);
        if (members === null) {
          if (name === 'publishNonCatalogEventByName') continue; // runtime-rejects catalogued types
          violate(call, 'unresolvable-event-type', `${name}() event type is not a literal; the guard cannot prove it is non-catalogued`);
        } else {
          const bad = members.filter((m) => catalog.has(m));
          if (bad.length) violate(call, 'catalogued-untyped-publish', `${name}() publishes catalogued event ${bad.join(', ')} without a registered builder; use publishWorkflowEvent`);
        }
        continue;
      }
    }

    // (4b) raw transport calls: EventBus.publish / RedisStreamClient.publishEvent / wrappers
    if (!isTransportImplementation(relPath)) {
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (!Node.isPropertyAccessExpression(expr)) continue;
        const method = expr.getName();
        if (method !== 'publish' && method !== 'publishEvent') continue;
        const receiverText = expr.getExpression().getText();
        const receiverType = expr.getExpression().getType().getSymbol()?.getName() ?? '';
        const isBus = method === 'publish' && (receiverType === 'EventBus' || /getEventBus\(\)$/.test(receiverText));
        const isStream = method === 'publishEvent' && (receiverType === 'RedisStreamClient' || /getRedisStreamClient\(\)$|redisClient$|streamClient$/i.test(receiverText));
        if (!isBus && !isStream) continue;
        const isWrapperInternal = wrapperHere.length > 0;
        const isCastSink = options.castSinks.some((s) => s.file === relPath);
        if (isWrapperInternal || isCastSink) continue; // covered by wrapper-call / alias checks below
        const arg = call.getArguments()[0];
        const props = isBus ? ['eventType'] : ['event_type', 'event_name'];
        const members = arg ? eventTypesOfEventArg(arg, props) : null;
        if (members === null) {
          violate(call, 'raw-transport-unresolvable', `${receiverText}.${method}() bypasses the typed publisher and its event type is not a literal; publish through publishWorkflowEvent`);
        } else {
          const bad = members.filter((m) => catalog.has(m));
          if (bad.length) violate(call, 'raw-transport-catalogued', `${receiverText}.${method}() publishes catalogued event ${bad.join(', ')} without a registered builder; publish through publishWorkflowEvent`);
        }
      }
    }
  }

  // (4c) calls to declared untyped wrappers (calendar publisher, legacy raw publishers)
  for (const wrapper of options.untypedWrappers) {
    const wrapperFile = project.getSourceFile(path.join(root, wrapper.file));
    if (!wrapperFile) continue;
    const decl = wrapperFile.getFunction(wrapper.name);
    if (!decl) continue;
    for (const ref of decl.findReferencesAsNodes()) {
      const call = ref.getParentIfKind(SyntaxKind.CallExpression);
      if (!call || call.getExpression() !== ref) continue;
      const refRel = rel(root, ref.getSourceFile().getFilePath());
      if (!productSet.has(ref.getSourceFile().getFilePath()) && !overlayPaths.includes(ref.getSourceFile().getFilePath())) continue;
      if (refRel === wrapper.file) continue;
      const arg = call.getArguments()[0];
      const members = arg ? eventTypesOfEventArg(arg, wrapper.eventTypeProps) : null;
      if (members === null) {
        violate(call, 'untyped-wrapper-unresolvable', `${wrapper.name}() from ${wrapper.file} is an untyped transport; its event type must be a literal the guard can resolve`);
      } else {
        const bad = members.filter((m) => catalog.has(m));
        if (bad.length) violate(call, 'untyped-wrapper-catalogued', `${wrapper.name}() from ${wrapper.file} is an untyped transport but publishes catalogued event ${bad.join(', ')}; use publishWorkflowEvent with a registered builder`);
      }
    }
  }

  // (4d) cast sinks: the declared event-name alias must stay non-catalogued
  for (const sink of options.castSinks) {
    const file = project.getSourceFile(path.join(root, sink.file));
    if (!file) continue;
    const alias = file.getTypeAlias(sink.eventNameAlias);
    if (!alias) {
      violations.push({ file: sink.file, line: 1, code: 'cast-sink-alias-missing', message: `type alias ${sink.eventNameAlias} not found; update the guard's castSinks table` });
      continue;
    }
    const members = stringLiteralMembers(alias.getType());
    if (members === null) violate(alias, 'cast-sink-unresolvable', `${sink.eventNameAlias} must be a union of string literals`);
    else {
      const bad = members.filter((m) => catalog.has(m));
      if (bad.length) violate(alias, 'cast-sink-catalogued', `${sink.file} publishes ${bad.join(', ')} through an untyped cast; these are catalogued events and need publishWorkflowEvent`);
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code));
  return {
    violations,
    stats: { productFiles: productFiles.length, contractFiles: contractFiles.length, catalogSize: catalog.size, registeredFunctions: reachable.size },
  };
}
