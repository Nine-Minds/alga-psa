import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * `crypto.randomUUID` is only defined in a **secure context** — HTTPS, or an
 * origin whose host is `localhost`/`127.0.0.1`. A reviewer or a self-hosted
 * operator reaching the app over plain HTTP on a LAN or tailnet address
 * (`http://100.82.172.57:3374`) gets `undefined` on `crypto.randomUUID`.
 *
 * Every mutating co-managed panel mints a client-side `operationId` (and some
 * mint an `attachmentId`/`grantId`) while assembling the request object — which
 * happens *before* the `try` that would have surfaced the failure. So the
 * `TypeError` became an unhandled rejection: escalation, hand-back, assignment,
 * delegation, departure, purchase, attachments and conversations all did
 * nothing at all, with no error shown to the user.
 *
 * Because `localhost` IS a secure context, no amount of local clicking
 * reproduces it — which is why this guard is source-text rather than runtime.
 *
 * The guard is over the CLASS, not the call sites that were fixed by hand: it
 * walks the real client-component import graph from every `'use client'` entry
 * in the co-managed surface and fails if `crypto.randomUUID` appears anywhere
 * that browser code can reach. Use `newCoManagedOperationId()` from
 * `server/src/components/co-managed/coManagedOperationId.ts` instead; `uuid`'s
 * v4 is built on `crypto.getRandomValues`, which exists in every context.
 */

const serverRoot = path.resolve(__dirname, '../../../..');

// Entry roots for the co-managed surface. A new co-managed directory that is
// not listed here still gets covered if an existing client component imports
// into it, because traversal follows relative imports wherever they lead.
const entryRoots = [
  'src/components/co-managed',
  'src/app/msp/co-managed',
  'src/app/msp/co-management',
];

const sourceExtensions = ['.ts', '.tsx'];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (sourceExtensions.includes(path.extname(full))) out.push(full);
  }
  return out;
}

/** Resolve a relative specifier the way the bundler does, including `/index`. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    ...sourceExtensions.map((ext) => base + ext),
    ...sourceExtensions.map((ext) => path.join(base, `index${ext}`)),
    base,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every `from '...'` / `import('...')` specifier in a source file. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const staticImport = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
  const bareImport = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const pattern of [staticImport, bareImport, dynamicImport]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) out.push(match[1]);
  }
  return out;
}

function isClientEntry(source: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*|\n)*['"]use client['"]/.test(source);
}

/**
 * Transitive closure of relative imports from every `'use client'` file in the
 * co-managed surface. A module without its own `'use client'` directive is
 * still browser code once a client component imports it — which is exactly how
 * `conversationDraftSubmission.ts` and `useCoManagedPurchaseController.ts`
 * shipped the defect — so reachability, not the directive, is the test.
 */
function clientReachableFiles(): string[] {
  const queue: string[] = [];
  const seen = new Set<string>();

  for (const root of entryRoots) {
    for (const file of walk(path.join(serverRoot, root))) {
      if (file.includes('.test.') || file.includes('.spec.')) continue;
      if (isClientEntry(readFileSync(file, 'utf8'))) queue.push(file);
    }
  }

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of specifiersOf(source)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveRelative(file, specifier);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }

  return [...seen].sort();
}

describe('co-managed client code and secure-context-only crypto', () => {
  const files = clientReachableFiles();

  it('discovers the co-managed client import graph', () => {
    // A traversal that silently found nothing would make every assertion below
    // vacuously true, so pin the shape of the graph rather than its exact size.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((file) => file.endsWith('CoManagedDelegatedAdministration.tsx'))).toBe(true);
    // Reached only via an import from a client component, never scanned directly.
    expect(files.some((file) => file.endsWith('conversationDraftSubmission.ts'))).toBe(true);
  });

  it('never calls crypto.randomUUID anywhere a browser can reach', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        // Skip comments — coManagedOperationId.ts documents the API it replaces.
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (/\bcrypto\s*\.\s*randomUUID\b/.test(code) || /\brandomUUID\s*\(/.test(code)) {
          offenders.push(`${path.relative(serverRoot, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      'crypto.randomUUID is undefined over plain HTTP on a non-localhost origin, and these ' +
        'call sites run while building a request — outside the try — so the panel fails ' +
        'silently. Use newCoManagedOperationId() from ' +
        'src/components/co-managed/coManagedOperationId.ts instead.\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('routes co-managed client id minting through the shared helper', () => {
    // The helper is the only sanctioned source of these ids; if it disappears or
    // stops being uuid-backed, the guard above would start passing for the wrong
    // reason (nothing left to mint ids with).
    const helperPath = path.join(serverRoot, 'src/components/co-managed/coManagedOperationId.ts');
    expect(existsSync(helperPath)).toBe(true);
    const helper = readFileSync(helperPath, 'utf8');
    expect(helper).toMatch(/from\s+'uuid'/);
    expect(helper).toMatch(/export function newCoManagedOperationId\(\): string/);

    const consumers = files.filter((file) =>
      /newCoManagedOperationId\s*\(/.test(readFileSync(file, 'utf8')),
    );
    expect(consumers.length).toBeGreaterThan(15);
  });
});
