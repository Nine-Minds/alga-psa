import { describe, expect, it } from 'vitest';
import { lstatSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

// A transaction callback holds one pooled connection. Anything inside it that
// acquires a second connection (a fresh createTenantKnex, or a helper that does
// so internally) can deadlock the pool under load: every request holds one and
// waits for another. Helpers below are the ones known to open their own
// connection; pass the callback's transaction handle instead, or hoist the call.
const repoRoot = path.resolve(process.cwd(), '..');
const scanRoots = ['server/src', 'packages', 'shared', 'ee/server/src', 'ee/packages', 'services'];
const skipPathParts = ['/node_modules/', '/dist/', '/.next/', '/build/', '/migrations/', '/seeds/', '/__tests__/', '/test/', '/tests/'];
const skipFileParts = ['.test.', '.spec.', '.d.ts'];

const directAcquirers = ['createTenantKnex', 'getConnection', 'getAdminConnection'];
const helperAcquirers = [
  'getTenantSettings',
  'getReferenceData',
  'getTenantDefaultLocale',
  'resolveEmailLocale',
  'getJobStatus',
  'getPortalDomainStatusForTenant',
  'getClientUserIdFromContact',
  'getEntityImageUrl',
];

const callbackOpen =
  /\bwithTransaction\(\s*([A-Za-z_$][\w$]*)\s*,\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)\b[^)]*\)\s*(?::\s*[^=]+)?=>\s*\{|\b([A-Za-z_$][\w$]*)\.transaction\(\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)\b[^)]*\)\s*(?::\s*[^=]+)?=>\s*\{/g;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (skipPathParts.some((part) => `${full}/`.includes(part))) continue;
    const stats = lstatSync(full);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(full) && !skipFileParts.some((part) => full.includes(part))) {
      out.push(full);
    }
  }
}

function matchBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return i;
  }
  return source.length;
}

function matchParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')' && --depth === 0) return i;
  }
  return source.length;
}

// After-commit hooks run once the transaction is over, so a fresh connection
// there is fine. Blank them out (preserving offsets) before scanning the body.
function withoutAfterCommitHooks(body: string): string {
  let out = body;
  const hook = /\bregisterAfterCommit\(/g;
  let m: RegExpExecArray | null;
  while ((m = hook.exec(body)) !== null) {
    const end = matchParen(body, m.index + m[0].length - 1);
    out = out.slice(0, m.index) + ' '.repeat(end - m.index + 1) + out.slice(end + 1);
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function findViolations(file: string, source: string): string[] {
  const violations: string[] = [];
  callbackOpen.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = callbackOpen.exec(source)) !== null) {
    const outer = m[1] ?? m[3];
    const trx = m[2] ?? m[4];
    if (outer === 'trx' || outer === 'transaction') continue; // nested frame reusing a handle
    const bodyStart = m.index + m[0].length;
    const bodyEnd = matchBrace(source, bodyStart - 1);
    const body = withoutAfterCommitHooks(source.slice(bodyStart, bodyEnd));
    const report = (offset: number, what: string) =>
      violations.push(`${path.relative(repoRoot, file)}:${lineOf(source, bodyStart + offset)} ${what} inside withTransaction(${outer}, ${trx} => ...)`);

    for (const name of directAcquirers) {
      const direct = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g');
      let d: RegExpExecArray | null;
      while ((d = direct.exec(body)) !== null) report(d.index, `${name}() opens a second connection`);
    }

    const perm = /\bhasPermission\s*\(/g;
    let p: RegExpExecArray | null;
    while ((p = perm.exec(body)) !== null) {
      const close = matchParen(body, p.index + p[0].length - 1);
      const args = body.slice(p.index + p[0].length, close);
      if (!new RegExp(`\\b${trx}\\b`).test(args)) report(p.index, `hasPermission() without the ${trx} handle`);
    }

    for (const name of helperAcquirers) {
      const helper = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g');
      let h: RegExpExecArray | null;
      while ((h = helper.exec(body)) !== null) {
        const close = matchParen(body, h.index + h[0].length - 1);
        const args = body.slice(h.index + h[0].length, close);
        if (!new RegExp(`\\b${trx}\\b`).test(args)) report(h.index, `${name}() acquires its own connection`);
      }
    }
  }
  return violations;
}

describe('transaction callbacks never acquire a second pooled connection', () => {
  it('finds no nested acquisitions in the repo', () => {
    const files: string[] = [];
    for (const root of scanRoots) {
      const dir = path.join(repoRoot, root);
      try {
        statSync(dir);
      } catch {
        continue;
      }
      walk(dir, files);
    }
    expect(files.length).toBeGreaterThan(500);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('withTransaction(') && !source.includes('.transaction(')) continue;
      violations.push(...findViolations(file, source));
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
