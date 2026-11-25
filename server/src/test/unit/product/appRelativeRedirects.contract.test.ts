import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Same-app redirects must never be built from the request origin.
 *
 * Behind Istio/CloudFront `request.nextUrl.origin` (and `new URL(req.url).origin`) is the
 * internal upstream, e.g. `https://localhost:3000`, so a redirect built from it sends
 * hosted users to a dead host (alga-2026-0003151). In-app redirects use
 * `redirectToAppPath` from `@alga-psa/core/redirectToAppPath` (relative `Location`).
 *
 * This scan flags a route handler / controller that both calls `.redirect(` and derives
 * an origin from the request. Redirects that legitimately need an absolute URL must take
 * it from a configured/public base URL helper (not from the request) and so do not
 * trip this. Anything else needs a per-file allow-list entry WITH a reason.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

const SCAN_ROOTS = [
  'server/src/app',
  'ee/server/src/app',
  'server/src/lib/api/controllers',
  'packages',
  'ee/packages',
];

const isHandlerFile = (rel: string): boolean => {
  if (/\.(test|spec)\.[tj]sx?$/.test(rel) || /(^|\/)(__tests__|node_modules|dist)\//.test(rel)) return false;
  if (!/\.[tj]sx?$/.test(rel)) return false;
  if (/(^|\/)route\.[tj]sx?$/.test(rel)) return true;
  if (/Controller\.[tj]s$/.test(rel)) return true;
  // Package route handlers re-exported by the app router, and Teams' callback handler.
  if (/^(ee\/)?packages\/[^/]+\/src\/(routes|app)\//.test(rel) && /(^|\/)api\//.test(rel)) return true;
  if (/handle[A-Z]\w*Callback\.[tj]s$/.test(rel)) return true;
  return false;
};

function walk(abs: string, out: string[]): void {
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue;
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else out.push(child);
  }
}

// A request-derived origin: `nextUrl.origin`, `<url-ish>.origin` of a URL parsed from the
// request, or a URL resolved against the request (`new URL(x, req.url)` / `req.nextUrl`).
const REQUEST_ORIGIN_PATTERNS: Array<[string, RegExp]> = [
  ['nextUrl.origin', /\bnextUrl\.origin\b/],
  ['new URL(req.url).origin', /new URL\(\s*[\w.]*(?:req|request)\w*\.url\s*\)\.origin/],
  ['<requestUrl>.origin', /\b(?:requestUrl|incomingUrl|reqUrl|url)\.origin\b/],
  ['new URL(x, req.url | req.nextUrl)', /new URL\([^;]*,\s*[\w.]*(?:req|request)\w*(?:\.nextUrl|\.url)\s*\)/],
];

const REDIRECT_CALL = /\b(?:NextResponse|Response)\.redirect\(/;

export function findRequestOriginRedirects(source: string): string[] {
  if (!REDIRECT_CALL.test(source)) return [];
  return REQUEST_ORIGIN_PATTERNS.filter(([, re]) => re.test(source)).map(([name]) => name);
}

/** Per-file allow-list. Every entry states why the request origin is acceptable there. */
const ALLOWED: Record<string, string> = {
  'server/src/app/api/auth/e2e/google/complete/route.ts':
    'E2E-only fake Google OAuth (gated off outside e2e); redirects resolve against the test client\'s own request URL, which is the public URL in that harness',
};

const files = (): string[] => {
  const abs: string[] = [];
  for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), abs);
  return abs.map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/')).filter(isHandlerFile);
};

describe('same-app redirects are not built from the request origin', () => {
  it('scans a non-trivial set of handler files (guards against a broken glob)', () => {
    const all = files();
    expect(all.length).toBeGreaterThan(100);
    expect(all).toContain('server/src/app/msp/go/[target]/route.ts');
    expect(all).toContain('server/src/lib/api/controllers/ApiMetadataController.ts');
  });

  it('no handler passes a request-derived origin to a redirect (outside the allow-list)', () => {
    const violations: string[] = [];
    for (const rel of files()) {
      if (rel in ALLOWED) continue;
      const hits = findRequestOriginRedirects(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
      if (hits.length) violations.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(
      violations,
      'Use redirectToAppPath (@alga-psa/core/redirectToAppPath) for in-app redirects, or an explicit public base URL helper for absolute ones.',
    ).toEqual([]);
  });

  it('every allow-list entry still exists, still trips the scan, and states a reason', () => {
    for (const [rel, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${rel} needs a reason`).toBeGreaterThan(20);
      const abs = path.join(REPO_ROOT, rel);
      expect(fs.existsSync(abs), `${rel} no longer exists; remove it from ALLOWED`).toBe(true);
      expect(
        findRequestOriginRedirects(fs.readFileSync(abs, 'utf8')).length,
        `${rel} no longer trips the scan; remove it from ALLOWED`,
      ).toBeGreaterThan(0);
    }
  });

  it('the detector catches the shapes that caused the bug', () => {
    expect(findRequestOriginRedirects("return NextResponse.redirect(new URL(d, request.nextUrl.origin));")).not.toEqual([]);
    expect(findRequestOriginRedirects("const url = new URL(req.url); return NextResponse.redirect(new URL('/x', url.origin));")).not.toEqual([]);
    expect(findRequestOriginRedirects("NextResponse.redirect(new URL('/x', req.url))")).not.toEqual([]);
    expect(findRequestOriginRedirects("NextResponse.redirect(new URL('/x', request.nextUrl))")).not.toEqual([]);
    expect(findRequestOriginRedirects("return redirectToAppPath('/x')")).toEqual([]);
    expect(findRequestOriginRedirects("const o = req.nextUrl.origin; return NextResponse.json({ o })")).toEqual([]);
    expect(findRequestOriginRedirects("NextResponse.redirect(new URL('/x', process.env.NEXTAUTH_URL))")).toEqual([]);
  });
});
