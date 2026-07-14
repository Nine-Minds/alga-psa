import fs from 'node:fs';
import path from 'node:path';

import {
  matchesDynamicPattern,
  matchesStaticPrefix,
  type ApiRule,
  type RouteRule,
} from '../../../../lib/productSurfaceRegistry';

// App Router roots. CE and EE both contribute to every surface.
const MSP_APP_ROOTS = [
  { dir: 'src/app/msp', urlBase: '/msp' },
  { dir: '../ee/server/src/app/msp', urlBase: '/msp' },
];
const PORTAL_APP_ROOTS = [
  { dir: 'src/app/client-portal', urlBase: '/client-portal' },
  { dir: '../ee/server/src/app/client-portal', urlBase: '/client-portal' },
];
const API_APP_ROOTS = [
  { dir: 'src/app/api', urlBase: '/api' },
  { dir: '../ee/server/src/app/api', urlBase: '/api' },
];

// Dynamic segments collapse to a single token so on-disk `[ticketId]` and a
// `/msp/tickets/${id}` link normalize to the same string.
export const DYNAMIC_SEGMENT = 'dynamic-segment';

// Pages are what users navigate to; route files declare API handlers. The
// walk semantics (route groups, @parallel slots, _private folders, dynamic
// segments) must stay identical across every inventory, so the file kind is
// the only thing callers vary.
export type RouteFileKind = 'page' | 'route' | 'any';
const MARKERS: Record<RouteFileKind, RegExp> = {
  page: /^page\.(t|j)sx?$/,
  route: /^route\.(t|j)sx?$/,
  any: /^(page|route)\.(t|j)sx?$/,
};

function walk(absDir: string, urlSegments: string[], out: Set<string>, marker: RegExp): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const name = entry.name;
      // @parallel slots and _private folders never produce a URL segment.
      if (name.startsWith('@') || name.startsWith('_')) continue;
      const nextSegments =
        name.startsWith('(') && name.endsWith(')')
          ? urlSegments
          : [...urlSegments, name.startsWith('[') ? DYNAMIC_SEGMENT : name];
      walk(path.join(absDir, name), nextSegments, out, marker);
    } else if (marker.test(entry.name)) {
      out.add(`/${urlSegments.join('/')}`);
    }
  }
}

export function collectRoutes(
  roots: Array<{ dir: string; urlBase: string }>,
  kind: RouteFileKind = 'page',
): Set<string> {
  const routes = new Set<string>();
  for (const root of roots) {
    walk(
      path.resolve(process.cwd(), root.dir),
      root.urlBase.slice(1).split('/'),
      routes,
      MARKERS[kind],
    );
  }
  return routes;
}

export function collectMspPageRoutes(): Set<string> {
  return collectRoutes(MSP_APP_ROOTS);
}

export function collectPortalPageRoutes(): Set<string> {
  return collectRoutes(PORTAL_APP_ROOTS);
}

export function collectApiRoutes(): Set<string> {
  return collectRoutes(API_APP_ROOTS, 'route');
}

// Immediate child directories that are URL segments — for classifying a
// route family (e.g. /msp/settings/<segment>) rather than deriving routes.
export function listRouteDirSegments(roots: string[]): Set<string> {
  const segments = new Set<string>();
  for (const root of roots) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.resolve(process.cwd(), root), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !/^[@_(]/.test(entry.name)) segments.add(entry.name);
    }
  }
  return segments;
}

export function matchesRules(
  rules: readonly (RouteRule | ApiRule)[],
  pathname: string,
): boolean {
  return rules.some(
    (rule) =>
      (rule.staticPrefixes && matchesStaticPrefix(pathname, rule.staticPrefixes)) ||
      (rule.dynamicPatterns && matchesDynamicPattern(pathname, rule.dynamicPatterns)),
  );
}
