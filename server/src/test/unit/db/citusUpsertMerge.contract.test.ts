import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Citus rejects any non-IMMUTABLE function in the DO UPDATE SET clause of an
 * upsert on a distributed table: "functions used in the DO UPDATE SET clause of
 * INSERTs on distributed tables must be marked IMMUTABLE". now() and
 * CURRENT_TIMESTAMP are only STABLE, so `.merge({ updated_at: knex.fn.now() })`
 * aborts the statement — even though the very same call is legal in the INSERT
 * values list, in a plain UPDATE, and on single-node Postgres. Typecheck and
 * local dev both stay green; it fails only on a sharded tenant, which is why
 * this is asserted on the sources.
 *
 * The fix is always to compute the value in Node and bind it as a param:
 *   .merge({ updated_at: new Date().toISOString() })
 *
 * Scope: merges whose conflict target mentions `tenant`, i.e. the tenant-keyed
 * tables that are (or will be) distributed. Instance-wide tables such as
 * mcp_oauth_clients conflict on their own id and are unaffected.
 */

// Tests run with cwd=server; the scanned sources span server/, packages/, ee/.
const repoRoot = path.resolve(process.cwd(), '..');

const SCAN_ROOTS = [
  'server/src',
  'packages',
  'shared',
  'ee/server/src',
  'ee/packages',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'build', 'migrations', 'seeds']);

/** Postgres clock/volatile functions that realistically appear in merge objects. */
const NON_IMMUTABLE_FUNCTIONS: { name: string; pattern: RegExp }[] = [
  { name: 'fn.now()', pattern: /\bfn\s*\.\s*now\s*\(/ },
  { name: "raw('now()')", pattern: /raw\s*\(\s*['"`][^'"`]*\bnow\s*\(\s*\)/i },
  { name: 'CURRENT_TIMESTAMP', pattern: /\bCURRENT_TIMESTAMP\b/i },
  { name: 'LOCALTIMESTAMP', pattern: /\bLOCALTIMESTAMP\b/i },
  { name: 'clock_timestamp()', pattern: /\bclock_timestamp\s*\(/i },
  { name: 'gen_random_uuid()', pattern: /\bgen_random_uuid\s*\(/i },
  { name: 'uuid_generate_v4()', pattern: /\buuid_generate_v[145]\s*\(/i },
  { name: 'nextval()', pattern: /\bnextval\s*\(/i },
];

function sourceFiles(): string[] {
  const files: string[] = [];
  const stack = SCAN_ROOTS.map((root) => path.join(repoRoot, root)).filter((dir) => existsSync(dir));

  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  return files;
}

/** Index just past the balanced call arguments that start at `open` ('('). */
function endOfCall(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Skip whitespace and the comments builder chains are usually annotated with. */
function skipTrivia(text: string, index: number): number {
  let i = index;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    return i;
  }
}

/** Every `.onConflict(<target>)` immediately followed by `.merge(<body>)`. */
function conflictMerges(text: string): { start: number; target: string; body: string }[] {
  const pairs: { start: number; target: string; body: string }[] = [];

  for (const match of text.matchAll(/\.onConflict\s*\(/g)) {
    const targetOpen = match.index! + match[0].length - 1;
    const targetClose = endOfCall(text, targetOpen);
    if (targetClose === -1) continue;

    const afterTarget = skipTrivia(text, targetClose + 1);
    const mergeMatch = /^\.merge\s*\(/.exec(text.slice(afterTarget));
    if (!mergeMatch) continue;

    const mergeOpen = afterTarget + mergeMatch[0].length - 1;
    const mergeClose = endOfCall(text, mergeOpen);
    if (mergeClose === -1) continue;

    pairs.push({
      start: match.index!,
      target: text.slice(targetOpen + 1, targetClose),
      body: text.slice(mergeOpen + 1, mergeClose),
    });
  }
  return pairs;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('Citus: no non-IMMUTABLE functions in tenant-keyed ON CONFLICT merges', () => {
  const files = sourceFiles();

  it('scans a meaningful number of sources', () => {
    // Guards the scanner itself against silently matching nothing.
    expect(files.length).toBeGreaterThan(500);
  });

  it('pairs onConflict with the merge that follows it, comments and all', () => {
    const annotated = conflictMerges(
      `await trx('t').insert({}).onConflict(['tenant', 'key'])\n` +
        `  // Citus rejects STABLE functions here.\n` +
        `  .merge({ updated_at: trx.fn.now() });`,
    );
    expect(annotated).toHaveLength(1);
    expect(annotated[0].target).toContain('tenant');
    expect(annotated[0].body).toContain('fn.now()');

    // `.onConflict(...).ignore()` has no merge object to police.
    expect(conflictMerges(`await trx('t').insert({}).onConflict(['tenant']).ignore();`)).toHaveLength(0);
  });

  it('no tenant-keyed upsert passes a non-IMMUTABLE function to DO UPDATE SET', () => {
    const violations: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('.onConflict')) continue;
      const relative = path.relative(repoRoot, file);

      for (const { start, target, body } of conflictMerges(text)) {
        if (!/\btenant\b/.test(target)) continue;
        for (const { name, pattern } of NON_IMMUTABLE_FUNCTIONS) {
          if (pattern.test(body)) {
            violations.push(`${relative}:${lineOf(text, start)} — ${name} in .merge()`);
          }
        }
      }
    }

    expect(
      violations,
      violations.length === 0
        ? ''
        : `Citus rejects non-IMMUTABLE functions in the DO UPDATE SET clause of upserts on ` +
          `distributed tables, so these fail at runtime with "functions used in the DO UPDATE SET ` +
          `clause of INSERTs on distributed tables must be marked IMMUTABLE" — compute the value ` +
          `in Node and bind it instead (e.g. updated_at: new Date().toISOString()):\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
