import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { collectMspPageRoutes, DYNAMIC_SEGMENT } from './support/appRouteInventory';

// Link-graph coverage: every /msp page on disk must be referenced from somewhere
// a user can act on. The registry-anchored suites reason about route *rules*
// (prefix granularity), so a new page under an already-ruled prefix —
// /msp/tickets/triage — is "ruled" and inherits a linked parent, and passes them
// both while being unreachable. This suite works at page granularity and asks the
// only question that matters: does anything link here?
//
// Every entry states how a user reaches the page WITHOUT an in-app link. A route
// parked here with no real entry point is an orphan page, not a documented one.
const KNOWN_UNLINKED_ROUTES: Record<string, string> = {
  '/msp/assets/automation': 'FeaturePlaceholder stub; link it when the feature ships',
  '/msp/assets/imports': 'FeaturePlaceholder stub; link it when the feature ships',
  '/msp/assets/integrations': 'FeaturePlaceholder stub; link it when the feature ships',
  '/msp/assets/maintenance': 'FeaturePlaceholder stub; link it when the feature ships',
  '/msp/assets/policies': 'FeaturePlaceholder stub; link it when the feature ships',
  '/msp/chat': 'chat ships as the right-sidebar overlay, not as a route',
  // TODO: real gap — the KB review queue (KnowledgeBasePage activeTab="review")
  // has no entry point anywhere in the app. Add one, then drop this entry.
  '/msp/knowledge-base/review': 'REPORTED GAP: no entry point; the review queue is unreachable until one is added',
  '/msp/marketing': 'index-only redirect to /msp/marketing/calendar; the nav sub-items link to the marketing subpages directly',
  '/msp/settings/mcp-server': 'deliberate: the MCP settings link is delivered by email, not surfaced in the settings rail',
  '/msp/share_document': 'emailed document-share links land here; no in-app entry point',
  '/msp/surveys/responses/dynamic-segment': 'deliberate: survey response links are delivered by email',
  '/msp/test': 'internal test-only pages, deliberately unlinked from all navigation',
  '/msp/test/collab': 'internal test-only page, deliberately unlinked',
  '/msp/test/onboarding': 'internal test-only page, deliberately unlinked',
  '/msp/test/ui-kit': 'internal test-only page, deliberately unlinked',
};

const SOURCE_ROOTS = ['src', '../ee/server/src', '../packages'];

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  '__tests__',
  '__mocks__',
  'test',
  'tests',
  'migrations',
  'seeds',
]);

// Files that name /msp paths without linking to them. The registry declares rule
// prefixes and the middleware matches them; counting either as a link would let a
// page look reachable merely because someone wrote a rule for it.
const SKIP_FILES = [
  /productSurfaceRegistry\.ts$/,
  /middleware\.ts$/,
  /\.(test|spec)\.(t|j)sx?$/,
  /\.stories\.(t|j)sx?$/,
];

const SOURCE_FILE = /\.(t|j)sx?$/;
const INTERPOLATION = /\$\{[^}]*\}/g;
const MSP_PATH = /\/msp\/[A-Za-z0-9_\-./]+/g;

// LEVERAGE: pattern source-tree-walker — same recursive walker as hardcodedCurrency
function collectSourceFiles(absDir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(abs, out);
    } else if (SOURCE_FILE.test(entry.name) && !SKIP_FILES.some((skip) => skip.test(entry.name))) {
      out.push(abs);
    }
  }
}

// Interpolations are already collapsed to the dynamic token, so a segment that
// carries any trace of one is dynamic: `${a}${b}` and `foo-${id}` alike.
function normalizeRoute(raw: string): string {
  return raw
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.includes(DYNAMIC_SEGMENT) ? DYNAMIC_SEGMENT : segment))
    .join('/')
    .replace(/^/, '/');
}

// One source path yields one ref, plus — when it ends in a slash — the dynamic
// child it is about to be concatenated with: `'/msp/extensions/' + id`.
function refsFrom(rawPath: string): string[] {
  const trimmed = rawPath.replace(/\/+$/, '');
  const refs = [normalizeRoute(trimmed)];
  if (rawPath.endsWith('/')) refs.push(normalizeRoute(`${trimmed}/${DYNAMIC_SEGMENT}`));
  return refs;
}

// A page that only links to itself (or to its own children) is still unreachable,
// so refs originating inside the route's own subtree don't count as entry points.
function routeContextOf(absFile: string): string | null {
  const normalized = absFile.replace(/\\/g, '/');
  const marker = '/app/msp';
  const at = normalized.indexOf(marker);
  if (at < 0) return null;
  const segments = normalized
    .slice(at + marker.length)
    .split('/')
    .slice(0, -1)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .filter((segment) => !segment.startsWith('@') && !segment.startsWith('_'))
    .map((segment) => (segment.startsWith('[') ? DYNAMIC_SEGMENT : segment));
  return segments.length ? `/msp/${segments.join('/')}` : '/msp';
}

// Segments must match exactly, dynamic to dynamic. A dynamic ref deliberately
// does NOT wildcard onto concrete routes: `redirect(`/msp/settings/${tab}`)`
// would otherwise mark every settings page — including ones no menu offers —
// as linked forever.
function refCovers(ref: string, route: string): boolean {
  return ref === route;
}

interface Reference {
  route: string;
  file: string;
  context: string | null;
}

function collectReferences(): Reference[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) {
    collectSourceFiles(path.resolve(process.cwd(), root), files);
  }

  const references: Reference[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.includes('/msp/')) continue;
    const source = raw.replace(INTERPOLATION, DYNAMIC_SEGMENT);
    const context = routeContextOf(file);
    for (const match of source.matchAll(MSP_PATH)) {
      // '/app/msp/...' is an import path, not a link.
      if (source.slice(Math.max(0, match.index - 4), match.index) === '/app') continue;
      for (const route of refsFrom(match[0])) {
        references.push({ route, file, context });
      }
    }
  }
  return references;
}

function linkedRoutes(references: Reference[], routes: Set<string>): Set<string> {
  const linked = new Set<string>();
  for (const route of routes) {
    const reachedFromOutside = references.some(
      (ref) =>
        refCovers(ref.route, route) &&
        !(ref.context === route || ref.context?.startsWith(`${route}/`)),
    );
    if (reachedFromOutside) linked.add(route);
  }
  return linked;
}

describe('route entry-point coverage (link graph)', () => {
  const routes = collectMspPageRoutes();
  const references = collectReferences();

  it('every /msp page on disk is linked from somewhere, or documents how it is reached', () => {
    expect(routes.size).toBeGreaterThan(20);
    expect(references.length).toBeGreaterThan(20);

    const linked = linkedRoutes(references, routes);
    const orphans = [...routes]
      .filter((route) => !linked.has(route))
      .filter((route) => !(route in KNOWN_UNLINKED_ROUTES))
      .sort();

    expect(
      orphans,
      `pages on disk that nothing links to — no nav item, button, redirect, or router.push anywhere in the source reaches them, so no user can navigate there. Add an entry point or document how the page is reached in KNOWN_UNLINKED_ROUTES: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('documented gaps stay honest: every KNOWN_UNLINKED_ROUTES entry still exists and is still unlinked', () => {
    const linked = linkedRoutes(references, routes);

    for (const known of Object.keys(KNOWN_UNLINKED_ROUTES)) {
      expect(
        routes.has(known),
        `"${known}" no longer has a page on disk — remove it from KNOWN_UNLINKED_ROUTES`,
      ).toBe(true);
      expect(
        linked.has(known),
        `"${known}" is now linked from the source — remove it from KNOWN_UNLINKED_ROUTES`,
      ).toBe(false);
    }
  });
});
