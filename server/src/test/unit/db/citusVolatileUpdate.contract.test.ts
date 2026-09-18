import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Citus rejects VOLATILE functions in an UPDATE on a distributed table:
 * "functions used in UPDATE queries on distributed tables must not be VOLATILE".
 * INSERT and standalone SELECT are fine, so the same helper reads as correct
 * everywhere except the one place it throws — and it throws at runtime, on the
 * shard, only for tenants whose table is actually distributed. Typecheck and
 * local single-node Postgres both stay green, so assert it on the sources.
 *
 * The fix is always to compute the value in Node and bind it as a param:
 *   trx.raw('COALESCE(event_id, ?)', [randomUUID()])
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

/**
 * Postgres functions marked VOLATILE that realistically appear in app-built
 * UPDATEs. now()/CURRENT_TIMESTAMP are STABLE and therefore allowed.
 */
const VOLATILE_FUNCTIONS: { name: string; pattern: RegExp }[] = [
  { name: 'gen_random_uuid()', pattern: /\bgen_random_uuid\s*\(/i },
  { name: 'uuid_generate_v4()', pattern: /\buuid_generate_v[145]\s*\(/i },
  { name: 'random()', pattern: /(?<!Math\.)\brandom\s*\(\s*\)/i },
  { name: 'clock_timestamp()', pattern: /\bclock_timestamp\s*\(/i },
  { name: 'timeofday()', pattern: /\btimeofday\s*\(/i },
  { name: 'nextval()', pattern: /\bnextval\s*\(/i },
  { name: 'gen_random_bytes()', pattern: /\bgen_random_bytes\s*\(/i },
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

/** The balanced-paren argument text of every `.update(` call in a file. */
function updateCallArguments(text: string): { start: number; body: string }[] {
  const calls: { start: number; body: string }[] = [];

  for (const match of text.matchAll(/\.update\s*\(/g)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const char = text[i];
      if (char === '(') depth++;
      else if (char === ')') {
        depth--;
        if (depth === 0) {
          calls.push({ start: match.index!, body: text.slice(open + 1, i) });
          break;
        }
      }
    }
  }
  return calls;
}

/**
 * Raw `UPDATE <table> SET ...` statements written as SQL strings, cut at the
 * first statement terminator so a later INSERT in the same literal (where
 * VOLATILE is legal) is not attributed to the UPDATE.
 */
function rawUpdateStatements(text: string): string[] {
  const statements: string[] = [];
  for (const match of text.matchAll(/\bUPDATE\s+(?:ONLY\s+)?["'`\w.]+\s+SET\b/gi)) {
    const rest = text.slice(match.index! + match[0].length);
    const end = rest.search(/;|\binsert\s+into\b|\bupdate\s+["'`\w.]+\s+set\b/i);
    statements.push(end === -1 ? rest.slice(0, 800) : rest.slice(0, end));
  }
  return statements;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('Citus: no VOLATILE functions in UPDATE statements', () => {
  const files = sourceFiles();

  it('scans a meaningful number of sources', () => {
    // Guards the scanner itself against silently matching nothing.
    expect(files.length).toBeGreaterThan(500);
  });

  it('finds the volatile-in-update violations it is meant to find', () => {
    const builder = updateCallArguments(
      `await trx('comments').update({ id: trx.raw('COALESCE(id, gen_random_uuid())') });`,
    );
    expect(builder).toHaveLength(1);
    expect(builder[0].body).toContain('gen_random_uuid');

    // An INSERT in the same literal must not be read as part of the UPDATE.
    const raw = rawUpdateStatements(
      "UPDATE t SET a = 1; INSERT INTO t (id) VALUES (gen_random_uuid())",
    );
    expect(raw).toHaveLength(1);
    expect(raw[0]).not.toContain('gen_random_uuid');
  });

  it('no application UPDATE passes a VOLATILE function to a distributed table', () => {
    const violations: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!VOLATILE_FUNCTIONS.some(({ pattern }) => pattern.test(text))) continue;
      const relative = path.relative(repoRoot, file);

      for (const call of updateCallArguments(text)) {
        for (const { name, pattern } of VOLATILE_FUNCTIONS) {
          if (pattern.test(call.body)) {
            violations.push(`${relative}:${lineOf(text, call.start)} — ${name} in .update()`);
          }
        }
      }

      for (const statement of rawUpdateStatements(text)) {
        for (const { name, pattern } of VOLATILE_FUNCTIONS) {
          if (pattern.test(statement)) {
            violations.push(`${relative} — ${name} in a raw UPDATE ... SET`);
          }
        }
      }
    }

    expect(
      violations,
      violations.length === 0
        ? ''
        : `Citus rejects VOLATILE functions in UPDATEs on distributed tables, so these fail at ` +
          `runtime with "functions used in UPDATE queries on distributed tables must not be ` +
          `VOLATILE" — compute the value in Node and bind it as a param instead ` +
          `(e.g. trx.raw('COALESCE(col, ?)', [randomUUID()])):\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
