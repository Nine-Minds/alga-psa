import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { REPO, closure, isForbiddenForWorkers } from './importGraph';

/**
 * AST gate-coverage contract (plan 2.7, acceptance A7).
 *
 * Every co-managed entry point must pass through one of the six capability
 * adapters, before it touches the database. Later cards extend
 * ENTRY_POINT_GLOBS; they never delete from it (registry sanity below).
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SCAN_ROOTS = ['server/src', 'packages', 'shared', 'services', 'ee/temporal-workflows', 'ee/server/src'] as const;

/**
 * The registry later cards extend. One entry per surface family in plan 2.7 / 4.
 * `ruleA: false` only for UI component trees: they are gated where they are
 * mounted (an RSC page adapter or `resolveUiSlots`), so a presentational child
 * need not re-gate; Rule C (no raw flag read) still applies to every file.
 */
export interface EntryPointFamily {
  id: string;
  glob: string;
  ruleA: boolean;
}

export const ENTRY_POINT_FAMILIES: readonly EntryPointFamily[] = [
  { id: 'rsc-pages', glob: 'server/src/app/msp/co-manag*/**', ruleA: true },
  { id: 'rest-routes', glob: 'server/src/app/api/**/co-management/**', ruleA: true },
  { id: 'server-actions', glob: 'server/src/lib/actions/coManaged*', ruleA: true },
  { id: 'package-actions', glob: 'packages/co-managed/src/**/actions*', ruleA: true },
  // Shared PSA/customer actions and token verification discover product and
  // trusted tenant first, then delegate to the separately registered guard.
  { id: 'user-invitation-actions', glob: 'packages/users/src/actions/user-actions/userInvitationActions.ts', ruleA: false },
  { id: 'user-invitation-service', glob: 'packages/users/src/services/UserInvitationService.ts', ruleA: false },
  { id: 'user-invitation-gate', glob: 'packages/users/src/lib/coManagedInvitationCapability.ts', ruleA: true },
  { id: 'jobs', glob: 'packages/jobs/**/coManaged*', ruleA: true },
  { id: 'subscribers', glob: 'server/src/lib/eventBus/subscribers/coManaged*', ruleA: true },
  { id: 'temporal-activities', glob: 'ee/temporal-workflows/src/activities/coManaged*', ruleA: true },
  { id: 'temporal-workflows', glob: 'ee/temporal-workflows/src/workflows/coManaged*', ruleA: true },
  // The Temporal files are kebab-case; the camelCase globs above do not match them.
  { id: 'temporal-activities-kebab', glob: 'ee/temporal-workflows/src/activities/co-managed*', ruleA: true },
  // A workflow sandbox cannot import the adapter: its activities carry the gate.
  { id: 'temporal-workflows-kebab', glob: 'ee/temporal-workflows/src/workflows/co-managed*', ruleA: false },
  { id: 'ee-server-actions', glob: 'ee/server/src/lib/actions/coManaged*', ruleA: true },
  { id: 'shared-services', glob: 'shared/services/**/coManaged*', ruleA: true },
  // Co-managed UI mounts (plan 4). DO-NOT-PORT 24's raw-flag boundary lived at
  // server/src/components/co-managed/CoManagedFeatureBoundary.tsx.
  { id: 'server-ui', glob: 'server/src/components/co-managed/**', ruleA: false },
  { id: 'package-ui', glob: 'packages/co-managed/src/components/**', ruleA: false },
];

export const ENTRY_POINT_GLOBS: readonly string[] = ENTRY_POINT_FAMILIES.map((f) => f.glob);

/**
 * Registry sanity, written out literally (not derived from the registry): the
 * exact family set and, per family, how many production files it matches at
 * HEAD. Deleting a family, swapping one for another, or narrowing a glob so it
 * stops matching files all fail. A card that adds co-managed entry points
 * updates the count in the same diff.
 */
export const EXPECTED_FAMILY_FILE_COUNTS: Readonly<Record<string, { glob: string; files: number }>> = {
  'rsc-pages': { glob: 'server/src/app/msp/co-manag*/**', files: 10 },
  'rest-routes': { glob: 'server/src/app/api/**/co-management/**', files: 0 },
  'server-actions': { glob: 'server/src/lib/actions/coManaged*', files: 11 },
  'package-actions': { glob: 'packages/co-managed/src/**/actions*', files: 0 },
  'user-invitation-actions': { glob: 'packages/users/src/actions/user-actions/userInvitationActions.ts', files: 1 },
  'user-invitation-service': { glob: 'packages/users/src/services/UserInvitationService.ts', files: 1 },
  'user-invitation-gate': { glob: 'packages/users/src/lib/coManagedInvitationCapability.ts', files: 1 },
  jobs: { glob: 'packages/jobs/**/coManaged*', files: 0 },
  subscribers: { glob: 'server/src/lib/eventBus/subscribers/coManaged*', files: 0 },
  'temporal-activities': { glob: 'ee/temporal-workflows/src/activities/coManaged*', files: 0 },
  'temporal-workflows': { glob: 'ee/temporal-workflows/src/workflows/coManaged*', files: 0 },
  'temporal-activities-kebab': { glob: 'ee/temporal-workflows/src/activities/co-managed*', files: 1 },
  'temporal-workflows-kebab': { glob: 'ee/temporal-workflows/src/workflows/co-managed*', files: 1 },
  'ee-server-actions': { glob: 'ee/server/src/lib/actions/coManaged*', files: 2 },
  'shared-services': { glob: 'shared/services/**/coManaged*', files: 0 },
  'server-ui': { glob: 'server/src/components/co-managed/**', files: 32 },
  'package-ui': { glob: 'packages/co-managed/src/components/**', files: 0 },
};

/** The six adapters (plus the three Next-free guard names they export). */
export const ADAPTER_EXPORTS = new Set([
  'requireCapabilityForAction', // 1 server action
  'capabilityRouteGuard', //       2 REST
  'requireCapabilityForPage', //   3 RSC
  'withCapabilityJob', //          4 job
  'isCapabilityServed', //         5 subscriber
  'filterCapabilityServed', //     5 subscriber (batch)
  'activityServesCapability', //   6 Temporal
  // 7 purchase surface (L8a): a purchase creates the FIRST entitlement, so `admits` (flag AND entitlement)
  // would make it unreachable. The surface is price AND kill switch AND release flag; it grants nothing.
  'isCoManagedPurchaseSurfaceOpen',
]);

const DB_TOUCHING = new Set(['createTenantKnex', 'tenantDb', 'runWithTenant', 'knex']);

/** file -> reason; reviewed in the diff. Applies to Rules B and C. Intentionally empty. */
export const ALLOWLIST: Record<string, string> = {};

/** Worker entries for Rule D. */
export const WORKER_ENTRY_GLOBS = ['services/*/src/index.ts', 'ee/temporal-workflows/src/worker.ts'] as const;
export const CAPABILITY_PURE_ENTRIES = [
  'packages/core/src/lib/capability.ts',
  'packages/jobs/src/lib/jobs/capabilityJob.ts',
] as const;

/**
 * Next/posthog specifiers that the Temporal worker's (much larger) build graph
 * already reached before this card, via packages the worker bundles. Rule D
 * pins the set: a NEW forbidden specifier, or the capability graph gaining
 * one, fails; a stale entry fails too.
 */
export const TEMPORAL_PREEXISTING_FORBIDDEN: Record<string, string> = {
  'next/headers.js': 'ui/lib/i18n/serverOnly',
  'next/headers': 'auth/getSession',
  'next/navigation': 'ui/context/UnsavedChangesContext',
  'posthog-js/react': 'ui/hooks/useFeatureFlag (not capability-related)',
  'next/link': 'ui/components/extensions/DynamicNavigationSlot',
  'next/image': 'auth/components/MspSignIn',
  'next/server': 'auth/lib/apiAuth',
};

// ---------------------------------------------------------------------------
// Glob + file model
// ---------------------------------------------------------------------------

export interface SourceFile {
  path: string; // repo-relative, posix
  source: string;
}

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?'; // `**/` = zero or more directories
        } else re += '.*';
      } else re += '[^/]*';
    } else if ('\\^$+?.()|{}[]'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

const FAMILY_RES = ENTRY_POINT_FAMILIES.map((f) => [f, globToRegExp(f.glob)] as const);

export const entryPointFamily = (path: string): EntryPointFamily | null =>
  FAMILY_RES.find(([, re]) => re.test(path))?.[0] ?? null;

export const matchesEntryPointGlob = (path: string): string | null => entryPointFamily(path)?.glob ?? null;

const isTestPath = (p: string) => /\.(test|spec)\.[tj]sx?$|(^|\/)__tests__\/|(^|\/)test\//.test(p) || p.startsWith('docs/');
const isSourcePath = (p: string) => /\.(ts|tsx|mjs|cjs|js)$/.test(p) && !p.endsWith('.d.ts');

/**
 * Under `app/` only the route modules are entry points (helpers beside a page
 * are not); everywhere else every glob match is one.
 */
export function isEntryPoint(path: string): boolean {
  if (!isSourcePath(path) || isTestPath(path)) return false;
  const family = entryPointFamily(path);
  if (!family || !family.ruleA) return false;
  if (path.startsWith('server/src/app/')) return /(^|\/)(page\.tsx?|route\.ts|layout\.tsx?)$/.test(path);
  return true;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.git', 'coverage', 'out', 'build']);

function walk(dir: string, acc: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // broken symlink
    }
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
}

export function scanRepo(): SourceFile[] {
  const abs: string[] = [];
  for (const r of SCAN_ROOTS) walk(join(REPO, r), abs);
  return abs
    .map((f) => relative(REPO, f).split('\\').join('/'))
    .filter((p) => isSourcePath(p) && !isTestPath(p))
    .map((p) => ({ path: p, source: readFileSync(join(REPO, p), 'utf8') }));
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const parse = (f: SourceFile) =>
  ts.createSourceFile(f.path, f.source, ts.ScriptTarget.Latest, true, f.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const calleeName = (c: ts.CallExpression): string | null =>
  ts.isIdentifier(c.expression) ? c.expression.text : ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text : null;

/** Rule A: adapter call present, and for action/page/route files before the first DB-touching await. */
export function ruleA(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files.filter((x) => isEntryPoint(x.path))) {
    const sf = parse(f);
    let adapterPos = Infinity;
    let dbAwaitPos = Infinity;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        if (name && ADAPTER_EXPORTS.has(name)) adapterPos = Math.min(adapterPos, n.getStart(sf));
      }
      if (ts.isAwaitExpression(n)) {
        let touches = false;
        const inner = (c: ts.Node) => {
          if (ts.isIdentifier(c) && DB_TOUCHING.has(c.text)) touches = true;
          ts.forEachChild(c, inner);
        };
        inner(n.expression);
        if (touches) dbAwaitPos = Math.min(dbAwaitPos, n.getStart(sf));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const where = matchesEntryPointGlob(f.path);
    if (adapterPos === Infinity) {
      out.push(`capabilityEntryPoints: ${f.path} (glob ${where}) never calls a capability adapter`);
      continue;
    }
    const orderSensitive = /(^|\/)(page\.tsx?|route\.ts)$|\/actions?[^/]*\.tsx?$|\/lib\/actions\//.test(f.path);
    if (orderSensitive && dbAwaitPos < adapterPos) {
      out.push(`capabilityEntryPoints: ${f.path} awaits database work before calling its capability adapter`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule A2: the tenant handed to a Next-bound adapter comes from the session
// ---------------------------------------------------------------------------

/** Adapters 1-3 take `(capability, tenantId, mode?)`; the tenant is argument 1. */
export const SESSION_TENANT_ADAPTERS = new Set(['requireCapabilityForAction', 'capabilityRouteGuard', 'requireCapabilityForPage']);
/** Calls whose result carries the session tenant at `.tenant` (user) or `.user.tenant` (session). */
const SESSION_OBJECT_SOURCES = new Set(['getSession', 'auth', 'getServerSession', 'getCurrentUser', 'getCurrentUserWithRevocationCheck']);
/** Zero-argument calls that return the session tenant itself. */
const SESSION_TENANT_HELPERS = new Set(['getCurrentTenant', 'getTenantForCurrentRequest']);

type Binding =
  | { kind: 'param'; fn: ts.SignatureDeclaration; index: number; path: string[] }
  | { kind: 'var'; init: ts.Expression; path: string[] };

function bindingPathTo(name: ts.BindingName, target: string, prefix: string[] = []): string[] | null {
  if (ts.isIdentifier(name)) return name.text === target ? prefix : null;
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    const key =
      ts.isObjectBindingPattern(name)
        ? el.propertyName
          ? ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName)
            ? el.propertyName.text
            : null
          : ts.isIdentifier(el.name)
            ? el.name.text
            : null
        : null; // array patterns never carry `.tenant`
    if (key === null) {
      if (bindingPathTo(el.name, target, [...prefix, '?']) !== null) return [...prefix, '?'];
      continue;
    }
    const found = bindingPathTo(el.name, target, [...prefix, key]);
    if (found) return found;
  }
  return null;
}

function resolveBinding(name: string, from: ts.Node): Binding | null {
  for (let n: ts.Node | undefined = from.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      const params = (n as ts.SignatureDeclaration).parameters;
      for (let i = 0; i < params.length; i++) {
        const path = bindingPathTo(params[i].name, name);
        if (path) return { kind: 'param', fn: n as ts.SignatureDeclaration, index: i, path };
      }
    }
    const statements = ts.isBlock(n) || ts.isSourceFile(n) ? n.statements : null;
    if (!statements) continue;
    for (const st of statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        const path = bindingPathTo(d.name, name);
        if (path && d.initializer) return { kind: 'var', init: d.initializer, path };
      }
    }
  }
  return null;
}

const unwrap = (e: ts.Expression): ts.Expression => {
  for (;;) {
    if (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
    else return e;
  }
};

const isWithAuthCallback = (fn: ts.SignatureDeclaration): boolean =>
  !!fn.parent && ts.isCallExpression(fn.parent) && fn.parent.arguments[0] === fn && calleeName(fn.parent) === 'withAuth';

/** Does `expr` (read at property `path`) evaluate to the authenticated session's tenant? */
export function isSessionTenant(expr: ts.Expression, path: string[] = [], depth = 0): boolean {
  if (depth > 20) return false;
  const e = unwrap(expr);
  if (ts.isPropertyAccessExpression(e)) return isSessionTenant(e.expression, [e.name.text, ...path], depth + 1);
  if (ts.isIdentifier(e)) {
    const b = resolveBinding(e.text, e);
    if (!b) return false;
    const full = [...b.path, ...path];
    if (b.kind === 'param') {
      // withAuth(async (user, ctx, ...args) => ...): user.tenant and ctx.tenant are the session tenant;
      // every later parameter is caller-supplied.
      return isWithAuthCallback(b.fn) && b.index <= 1 && full.length === 1 && full[0] === 'tenant';
    }
    return isSessionTenant(b.init, full, depth + 1);
  }
  if (ts.isCallExpression(e)) {
    const name = calleeName(e);
    if (name && SESSION_TENANT_HELPERS.has(name)) return e.arguments.length === 0 && path.length === 0;
    if (name && SESSION_OBJECT_SOURCES.has(name)) {
      const p = path.join('.');
      return e.arguments.length === 0 && (p === 'tenant' || p === 'user.tenant');
    }
  }
  return false;
}

/** Rule A2: adapters 1-3 in co-managed entry points take the tenant from the session, never from input. */
export function ruleA2(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files.filter((x) => isEntryPoint(x.path))) {
    const sf = parse(f);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n);
        if (name && SESSION_TENANT_ADAPTERS.has(name)) {
          const tenant = n.arguments[1];
          if (!tenant || !isSessionTenant(tenant)) {
            out.push(
              `capabilityEntryPoints: ${name} at ${f.path}:${lineOf(sf, n)} takes a tenant that does not come from the authenticated session (${tenant ? tenant.getText(sf) : 'missing'})`,
            );
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Rule B: the retired flag key, anywhere in scanned source. */
export function ruleB(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.path in ALLOWLIST || !f.source.includes('release-v1-6-feature')) continue;
    const sf = parse(f);
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteralLike(n) && n.text === 'release-v1-6-feature') {
        out.push(
          `capabilityEntryPoints: 'release-v1-6-feature' is retired for co-managed gating — use useCapability('co-managed') or the server adapter (${f.path}:${lineOf(sf, n)})`,
        );
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Rule C: raw flag reads inside co-managed entry points. */
export function ruleC(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.path in ALLOWLIST || !matchesEntryPointGlob(f.path) || !isSourcePath(f.path) || isTestPath(f.path)) continue;
    const sf = parse(f);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && calleeName(n) === 'useFeatureFlag') {
        const a = n.arguments[0];
        if (a && ts.isStringLiteralLike(a) && (a.text === 'release-v2-0-feature' || a.text.startsWith('capability:'))) {
          out.push(
            `capabilityEntryPoints: raw useFeatureFlag('${a.text}') at ${f.path}:${lineOf(sf, n)} — co-managed UI must read useCapability('co-managed'); the release flag alone never changes co-managed behaviour`,
          );
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Additional rule: serves / servesBatch / filterServed never reference the flag evaluator. */
export function identifiersInFunctions(source: string, names: string[]): Record<string, string[]> {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const found: Record<string, string[]> = {};
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text) && n.body) {
      const ids: string[] = [];
      const inner = (c: ts.Node) => {
        if (ts.isIdentifier(c)) ids.push(c.text);
        ts.forEachChild(c, inner);
      };
      inner(n.body);
      found[n.name.text] = ids;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}
export function ruleServesHasNoFlag(source: string): string[] {
  const ids = identifiersInFunctions(source, ['serves', 'servesBatch', 'filterServed']);
  const out = Object.keys(ids).length === 3 ? [] : ['serves/servesBatch/filterServed not all found'];
  for (const [fn, names] of Object.entries(ids)) {
    for (const bad of ['isFeatureFlagEnabled', 'computeAdmits', 'admits']) {
      if (names.includes(bad)) out.push(`capabilityEntryPoints: ${fn} references ${bad}; serves must never evaluate the release flag`);
    }
  }
  return out;
}

/**
 * Rule E: the gate's test-only hatches (`resetCapabilityRegistry`,
 * `clearCapabilityCache`) are unreachable from production code. They live in
 * `packages/core/src/capability/testing.ts`, which is not a package export and
 * which no production file may import (by subpath or relative path).
 */
export function ruleE(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.path === 'packages/core/src/capability/testing.ts' || !f.source.includes('capability/testing')) continue;
    const sf = parse(f);
    const visit = (n: ts.Node) => {
      const spec =
        (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)
          ? n.moduleSpecifier.text
          : ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) &&
              (n.expression.kind === ts.SyntaxKind.ImportKeyword || calleeName(n) === 'require')
            ? (n.arguments[0] as ts.StringLiteralLike).text
            : null;
      if (spec && /(^|\/)capability\/testing(\.[jt]s)?$/.test(spec)) {
        out.push(`capabilityEntryPoints: production file ${f.path}:${lineOf(sf, n)} imports the capability test hatch '${spec}'`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Rule D: posthog-js/react and next/* unreachable from the capability graph and worker entries. */
export function ruleD(
  workerEntries: string[],
  readSource?: (file: string) => string | undefined,
  pureEntries: readonly string[] = CAPABILITY_PURE_ENTRIES,
): string[] {
  const out: string[] = [];
  for (const e of pureEntries) {
    const c = closure(e, readSource);
    for (const s of c.bare) if (isForbiddenForWorkers(s)) out.push(`capabilityEntryPoints: ${s} reachable from ${e}`);
    for (const f of c.files) if (/capability\/server\.ts$/.test(f) || /useCapability|bootstrapContext/.test(f)) out.push(`capabilityEntryPoints: ${e} reaches Next/React-bound ${relative(REPO, f)}`);
  }
  for (const e of workerEntries) {
    const c = closure(e, readSource);
    const isTemporal = e.startsWith('ee/temporal-workflows/');
    for (const s of c.bare) {
      if (!isForbiddenForWorkers(s)) continue;
      if (isTemporal && s in TEMPORAL_PREEXISTING_FORBIDDEN) continue;
      out.push(`capabilityEntryPoints: ${s} reachable from worker entry ${e}`);
    }
    for (const f of c.files) {
      if (/capability\/server\.ts$/.test(f)) out.push(`capabilityEntryPoints: worker entry ${e} reaches @alga-psa/core/capability/server`);
    }
  }
  return out;
}

/** Registry sanity: the registry must equal the literal expectation, family by family. */
export function registrySanity(families: readonly EntryPointFamily[], files: SourceFile[]): string[] {
  const out: string[] = [];
  const expectedIds = Object.keys(EXPECTED_FAMILY_FILE_COUNTS).sort();
  const actualIds = families.map((f) => f.id).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    out.push(`capabilityEntryPoints: registry families [${actualIds.join(', ')}] != expected [${expectedIds.join(', ')}]`);
  }
  for (const fam of families) {
    const expected = EXPECTED_FAMILY_FILE_COUNTS[fam.id];
    if (!expected) continue;
    if (fam.glob !== expected.glob) out.push(`capabilityEntryPoints: family ${fam.id} glob ${fam.glob} != expected ${expected.glob}`);
    let re: RegExp;
    try {
      re = globToRegExp(fam.glob);
    } catch {
      out.push(`capabilityEntryPoints: family ${fam.id} glob ${fam.glob} is malformed`);
      continue;
    }
    const matched = files.filter((f) => re.test(f.path)).length;
    if (matched !== expected.files) {
      out.push(`capabilityEntryPoints: family ${fam.id} matches ${matched} production files, expected ${expected.files}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const repoFiles = scanRepo();
const workerEntries = repoFiles
  .map((f) => f.path)
  .filter((p) => WORKER_ENTRY_GLOBS.some((g) => globToRegExp(g).test(p)));

describe('capability gate coverage (AST) — branch is green', () => {
  it('scans a plausible number of production files', () => {
    expect(repoFiles.length).toBeGreaterThan(500);
  });

  it('Rule A: every co-managed entry point calls an adapter before DB work', () => {
    expect(ruleA(repoFiles)).toEqual([]);
  });

  it('Rule A2: Next-bound adapters take the tenant from the authenticated session', () => {
    expect(ruleA2(repoFiles)).toEqual([]);
  });

  it('Rule B: release-v1-6-feature is referenced nowhere', () => {
    expect(ruleB(repoFiles)).toEqual([]);
  });

  it('Rule C: no raw release flag reads inside co-managed entry points', () => {
    expect(ruleC(repoFiles)).toEqual([]);
  });

  it('serves / servesBatch / filterServed never reference the flag evaluator', () => {
    const src = readFileSync(join(REPO, 'packages/core/src/lib/capability.ts'), 'utf8');
    expect(ruleServesHasNoFlag(src)).toEqual([]);
  });

  it('Rule D: next/* and posthog-js/react are unreachable from the capability graph and worker entries', () => {
    for (const e of ['ee/temporal-workflows/src/worker.ts', 'services/email-service/src/index.ts', 'services/workflow-worker/src/index.ts']) {
      expect(workerEntries).toContain(e);
    }
    expect(ruleD(workerEntries)).toEqual([]);
  });

  it('Rule E: no production file imports the capability test hatch; the pure entry exports none', () => {
    expect(ruleE(repoFiles)).toEqual([]);
    const pure = readFileSync(join(REPO, 'packages/core/src/lib/capability.ts'), 'utf8');
    expect(pure).not.toMatch(/export function (resetCapabilityRegistry|clearCapabilityCache)\b/);
    const pkg = JSON.parse(readFileSync(join(REPO, 'packages/core/package.json'), 'utf8'));
    expect(Object.keys(pkg.exports)).not.toContain('./capability/testing');
  });

  it('Rule D baseline for the Temporal worker has no stale entries', () => {
    const reached = new Set([...closure('ee/temporal-workflows/src/worker.ts').bare].filter(isForbiddenForWorkers));
    for (const spec of Object.keys(TEMPORAL_PREEXISTING_FORBIDDEN)) expect(reached.has(spec), spec).toBe(true);
  });

  it('registry sanity: exactly the expected families, globs and per-family file counts', () => {
    expect(registrySanity(ENTRY_POINT_FAMILIES, repoFiles)).toEqual([]);
  });

  it('allowlist has no stale entries', () => {
    const paths = new Set(repoFiles.map((f) => f.path));
    for (const f of Object.keys(ALLOWLIST)) {
      expect(paths.has(f), `${f} no longer exists`).toBe(true);
      const src = repoFiles.find((x) => x.path === f)!.source;
      expect(src.includes('release-v1-6-feature') || matchesEntryPointGlob(f) !== null, `${f} no longer needs its allowlist entry`).toBe(true);
    }
  });

  it('ProjectDetail Timeline keeps its own flag read and is not an entry point', () => {
    const f = repoFiles.find((x) => x.path === 'packages/projects/src/components/ProjectDetail.tsx')!;
    expect(f.source).toContain("useFeatureFlag('release-v2-0-feature'");
    expect(matchesEntryPointGlob(f.path)).toBeNull();
    expect(ruleC([f])).toEqual([]);
  });
});

describe('glob matching', () => {
  it.each([
    // Glob sample only: this page does not exist yet (it ships in L9), but the glob must already cover it.
    ['server/src/app/msp/co-managed/providers/page.tsx', true],
    ['server/src/app/msp/co-managed/page.tsx', true],
    ['server/src/app/msp/tickets/page.tsx', false],
    ['server/src/app/api/v1/co-management/providers/route.ts', true],
    ['server/src/app/api/co-management/route.ts', true],
    ['server/src/lib/actions/coManagedActions.ts', true],
    ['server/src/lib/actions/ticketActions.ts', false],
    ['packages/co-managed/src/lib/actions.ts', true],
    ['packages/co-managed/src/a/b/actionsFoo.ts', true],
    ['packages/jobs/src/lib/jobs/handlers/coManagedSync.ts', true],
    ['server/src/lib/eventBus/subscribers/coManagedSubscriber.ts', true],
    ['ee/temporal-workflows/src/activities/coManagedActivities.ts', true],
    ['ee/temporal-workflows/src/workflows/coManagedWorkflow.ts', true],
    ['shared/services/x/y/coManagedService.ts', true],
    ['server/src/components/co-managed/CoManagedFeatureBoundary.tsx', true],
    ['server/src/components/co-managed/nested/Panel.tsx', true],
    ['packages/co-managed/src/components/Workspace.tsx', true],
    ['server/src/components/tickets/TicketDetails.tsx', false],
  ])('%s -> %s', (path, expected) => {
    expect(matchesEntryPointGlob(path) !== null).toBe(expected);
  });
});

describe('negative fixtures: each rule bites, through the real glob and rule functions', () => {
  const ACTION = 'server/src/lib/actions/coManagedFixtureActions.ts';
  const file = (path: string, source: string): SourceFile => ({ path, source });

  it('Rule A fails on a stub co-managed action that does DB work with no adapter', () => {
    const f = file(
      ACTION,
      `export async function listProviders() {
         const { knex } = await createTenantKnex();
         return knex('co_management_providers').select('*');
       }`,
    );
    const v = ruleA([f]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('never calls a capability adapter');
  });

  it('Rule A fails when the adapter is called AFTER the DB await', () => {
    const f = file(
      ACTION,
      `export async function listProviders(tenant: string) {
         const { knex } = await createTenantKnex();
         await requireCapabilityForAction('co-managed', tenant);
         return knex('co_management_providers').select('*');
       }`,
    );
    const v = ruleA([f]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('before calling its capability adapter');
  });

  it('Rule A passes when the adapter comes first', () => {
    const f = file(
      ACTION,
      `export async function listProviders(tenant: string) {
         await requireCapabilityForAction('co-managed', tenant);
         const { knex } = await createTenantKnex();
         return knex('co_management_providers').select('*');
       }`,
    );
    expect(ruleA([f])).toEqual([]);
  });

  it('Rule A covers pages, routes, jobs and activities (adapter forms and non-entry helpers)', () => {
    expect(ruleA([file('server/src/app/msp/co-managed/page.tsx', `export default async function P(){ return null; }`)])).toHaveLength(1);
    expect(ruleA([file('server/src/app/msp/co-managed/helper.ts', `export const x = 1;`)])).toEqual([]);
    expect(ruleA([file('server/src/app/api/v1/co-management/x/route.ts', `export async function GET(){ const g = await capabilityRouteGuard('co-managed','t'); return g; }`)])).toEqual([]);
    expect(ruleA([file('packages/jobs/src/lib/jobs/handlers/coManagedSync.ts', `export const h = withCapabilityJob('co-managed', async () => { await knex('x'); });`)])).toEqual([]);
    expect(ruleA([file('ee/temporal-workflows/src/activities/coManagedA.ts', `export async function a(){ return knex('x'); }`)])).toHaveLength(1);
  });

  describe('Rule A2: the tenant argument', () => {
    const ok = (src: string, path = ACTION) => expect(ruleA2([file(path, src)])).toEqual([]);
    const bad = (src: string, path = ACTION) => expect(ruleA2([file(path, src)])).toHaveLength(1);

    it('accepts the withAuth context and user', () => {
      ok(`export const a = withAuth(async (user, { tenant }, id: string) => { await requireCapabilityForAction('co-managed', tenant); });`);
      ok(`export const a = withAuth(async (user, ctx) => { await requireCapabilityForAction('co-managed', ctx.tenant); });`);
      ok(`export const a = withAuth(async (user, ctx) => { const t = ctx.tenant; await requireCapabilityForAction('co-managed', t); });`);
      ok(`export const a = withAuth(async (user) => { await requireCapabilityForAction('co-managed', user.tenant, 'serves'); });`);
    });

    it('accepts session-derived tenants in pages and routes', () => {
      ok(`export default async function P() { const session = await getSession(); await requireCapabilityForPage('co-managed', session!.user.tenant); }`, 'server/src/app/msp/co-managed/page.tsx');
      ok(`export default async function P() { const tenant = await getCurrentTenant(); await requireCapabilityForPage('co-managed', tenant); }`, 'server/src/app/msp/co-managed/page.tsx');
      ok(`export async function GET() { const user = await getCurrentUser(); return capabilityRouteGuard('co-managed', user!.tenant); }`, 'server/src/app/api/v1/co-management/x/route.ts');
      ok(`export async function GET() { const { user } = (await getSession())!; return capabilityRouteGuard('co-managed', user.tenant); }`, 'server/src/app/api/v1/co-management/x/route.ts');
    });

    it('rejects a tenant from the request body, query, route params or an action argument', () => {
      bad(`export async function POST(req: Request) { const body = await req.json(); return capabilityRouteGuard('co-managed', body.tenantId); }`, 'server/src/app/api/v1/co-management/x/route.ts');
      bad(`export async function GET(req: NextRequest) { return capabilityRouteGuard('co-managed', req.nextUrl.searchParams.get('tenant')!); }`, 'server/src/app/api/v1/co-management/x/route.ts');
      bad(`export default async function P({ params }) { await requireCapabilityForPage('co-managed', params.tenant); }`, 'server/src/app/msp/co-managed/page.tsx');
      bad(`export const a = withAuth(async (user, ctx, input: { tenant: string }) => { await requireCapabilityForAction('co-managed', input.tenant); });`);
      bad(`export const a = withAuth(async (user, ctx, tenant: string) => { await requireCapabilityForAction('co-managed', tenant); });`);
      bad(`export async function a(tenantId: string) { await requireCapabilityForAction('co-managed', tenantId); }`);
      bad(`export async function a() { await requireCapabilityForAction('co-managed', 'tenant-1'); }`);
      bad(`export async function a() { const t = await getTenantForCurrentRequest(body.tenant); await requireCapabilityForAction('co-managed', t); }`);
      bad(`export const a = withAuth(async (user, ctx) => { await requireCapabilityForAction('co-managed', ctx.other); });`);
    });

    it('does not apply to worker adapters, whose tenant comes from the job, event or activity input', () => {
      ok(`export async function a(input: { tenantId: string }) { return activityServesCapability('co-managed', input.tenantId); }`, 'ee/temporal-workflows/src/activities/coManagedA.ts');
    });
  });

  it('Rule B fails on any release-v1-6-feature reference, with the plan message', () => {
    const v = ruleB([file('packages/anything/src/Foo.tsx', `const x = useFeatureFlag('release-v1-6-feature');`)]);
    expect(v).toEqual([
      "capabilityEntryPoints: 'release-v1-6-feature' is retired for co-managed gating — use useCapability('co-managed') or the server adapter (packages/anything/src/Foo.tsx:1)",
    ]);
  });

  it("Rule C fails on a raw useFeatureFlag('release-v2-0-feature') in a co-managed entry point", () => {
    const f = file(
      'server/src/app/msp/co-managed/page.tsx',
      `export default function P() {\n  const { enabled } = useFeatureFlag('release-v2-0-feature');\n  return null;\n}`,
    );
    const v = ruleC([f]);
    expect(v).toHaveLength(1);
    expect(v[0]).toBe(
      "capabilityEntryPoints: raw useFeatureFlag('release-v2-0-feature') at server/src/app/msp/co-managed/page.tsx:2 — co-managed UI must read useCapability('co-managed'); the release flag alone never changes co-managed behaviour",
    );
  });

  it("Rule C fails on useFeatureFlag('capability:*') and ignores the same call outside entry points", () => {
    expect(ruleC([file(ACTION, `useFeatureFlag('capability:co-managed');`)])).toHaveLength(1);
    expect(ruleC([file('packages/projects/src/components/ProjectDetail.tsx', `useFeatureFlag('release-v2-0-feature');`)])).toEqual([]);
  });

  it('Rule C catches DO-NOT-PORT 24 at its own path: a raw-flag CoManagedFeatureBoundary', () => {
    const boundary = file(
      'server/src/components/co-managed/CoManagedFeatureBoundary.tsx',
      `export function CoManagedFeatureBoundary({ children }) {\n  const { enabled } = useFeatureFlag('release-v2-0-feature');\n  return enabled ? children : null;\n}`,
    );
    expect(ruleC([boundary])).toHaveLength(1);
    expect(ruleC([file('packages/co-managed/src/components/Tab.tsx', `useFeatureFlag('capability:co-managed');`)])).toHaveLength(1);
    // UI component trees are gated at their mount; a child without an adapter is not a Rule A failure.
    expect(ruleA([file('server/src/components/co-managed/Panel.tsx', `export const Panel = () => null;`)])).toEqual([]);
  });

  it('registry sanity fails when a family is dropped, swapped for another, or narrowed', () => {
    const dropped = ENTRY_POINT_FAMILIES.filter((f) => f.id !== 'server-ui');
    expect(registrySanity(dropped, repoFiles).some((m) => m.includes('!= expected ['))).toBe(true);

    const swapped = [...dropped, { id: 'something-else', glob: 'server/src/elsewhere/**', ruleA: true }];
    expect(registrySanity(swapped, repoFiles).some((m) => m.includes('!= expected ['))).toBe(true);

    const narrowed = ENTRY_POINT_FAMILIES.map((f) => (f.id === 'server-actions' ? { ...f, glob: 'server/src/lib/actions/coManagedX*' } : f));
    expect(registrySanity(narrowed, repoFiles).some((m) => m.includes('family server-actions glob'))).toBe(true);

    const withFile = [...repoFiles, file('server/src/lib/actions/coManagedProviders.ts', 'export {}')];
    expect(registrySanity(ENTRY_POINT_FAMILIES, withFile)).toEqual([
      `capabilityEntryPoints: family server-actions matches ${EXPECTED_FAMILY_FILE_COUNTS['server-actions'].files + 1} production files, expected ${EXPECTED_FAMILY_FILE_COUNTS['server-actions'].files}`,
    ]);
  });

  it('Rule E fails on a production import of the test hatch, by subpath, relative path or dynamic import', () => {
    expect(ruleE([file('server/src/lib/foo.ts', `import { resetCapabilityRegistry } from '@alga-psa/core/capability/testing';`)])).toHaveLength(1);
    expect(ruleE([file('packages/core/src/lib/bar.ts', `export * from '../capability/testing';`)])).toHaveLength(1);
    expect(ruleE([file('shared/x.ts', `const t = await import('@alga-psa/core/capability/testing');`)])).toHaveLength(1);
    expect(ruleE([file('server/src/lib/ok.ts', `import { admits } from '@alga-psa/core/capability';`)])).toEqual([]);
  });

  it('serves-has-no-flag rule fails when serves references the flag evaluator', () => {
    const bad = `export async function serves(c, t) { return isFeatureFlagEnabled('x', { tenantId: t }); }
                 async function servesBatch() {}
                 export async function filterServed() {}`;
    expect(ruleServesHasNoFlag(bad)).toHaveLength(1);
  });

  it('Rule D fails when the pure capability entry gains a next/* import', () => {
    const real = readFileSync(join(REPO, 'packages/core/src/lib/capability.ts'), 'utf8');
    const target = join(REPO, 'packages/core/src/lib/capability.ts');
    const v = ruleD([], (f) => (f === target ? `import { notFound } from 'next/navigation';\n${real}` : undefined));
    expect(v.some((m) => m.includes('next/navigation reachable from packages/core/src/lib/capability.ts'))).toBe(true);
  });

  it('Rule D fails when a pure entry reaches posthog-js/react or capability/server', () => {
    const target = join(REPO, 'packages/jobs/src/lib/jobs/capabilityJob.ts');
    const real = readFileSync(target, 'utf8');
    const v = ruleD([], (f) => (f === target ? `import 'posthog-js/react';\nimport '@alga-psa/core/capability/server';\n${real}` : undefined));
    expect(v.some((m) => m.includes('posthog-js/react'))).toBe(true);
    expect(v.some((m) => m.includes('capability/server'))).toBe(true);
  });

  it('Rule D fails when a services entry imports a Next module', () => {
    const entry = 'services/email-service/src/index.ts';
    const target = join(REPO, entry);
    const real = readFileSync(target, 'utf8');
    const v = ruleD([entry], (f) => (f === target ? `import 'next/headers';\n${real}` : undefined), []);
    expect(v).toContain(`capabilityEntryPoints: next/headers reachable from worker entry ${entry}`);
  });
});

// ---------------------------------------------------------------------------
// UI-slot mounts: every place that resolves a capability-gated UI slot is
// enumerated here, and each one derives its served set from the capability
// hook (never a raw flag read). A new mount is added to this list in the same
// diff, with its test.
// ---------------------------------------------------------------------------

const UI_SLOT_MOUNTS: Readonly<Record<string, string>> = {
  'server/src/components/layout/SidebarWithFeatureFlags.tsx': 'msp.navigation.group',
};
const UI_SLOT_CONTRIBUTIONS: Readonly<Record<string, string>> = {
  'server/src/config/coManagedMenu.ts': 'msp.navigation.group',
};

describe('UI-slot mounts (A8)', () => {
  const mounts = repoFiles.filter((f) => isSourcePath(f.path) && !isTestPath(f.path) && /\bresolveUiSlots\s*[<(]/.test(f.source)
    && !f.path.endsWith('uiSlotRegistry.ts'));

  it('enumerates every resolveUiSlots mount', () => {
    expect(mounts.map((f) => f.path).sort()).toEqual(Object.keys(UI_SLOT_MOUNTS).sort());
  });

  it("each mount serves slots from useCapability('co-managed') and names its surface", () => {
    for (const f of mounts) {
      expect(f.source, f.path).toContain("useCapability('co-managed')");
      expect(f.source, f.path).toContain(`'${UI_SLOT_MOUNTS[f.path]}'`);
      expect(f.source, f.path).not.toMatch(/useFeatureFlag\(\s*'release-v2-0-feature'/);
    }
  });

  it('every registerUiSlot contribution is enumerated and gated on the co-managed capability', () => {
    const contributions = repoFiles.filter((f) => isSourcePath(f.path) && !isTestPath(f.path) && /\bregisterUiSlot\s*[<(]/.test(f.source)
      && !f.path.endsWith('uiSlotRegistry.ts'));
    expect(contributions.map((f) => f.path).sort()).toEqual(Object.keys(UI_SLOT_CONTRIBUTIONS).sort());
    for (const f of contributions) {
      expect(f.source, f.path).toContain("capability: 'co-managed'");
      expect(f.source, f.path).toContain(`'${UI_SLOT_CONTRIBUTIONS[f.path]}'`);
    }
  });
});
