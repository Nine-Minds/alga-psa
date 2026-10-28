import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { OPERATIONAL_WRITE_TABLES, RETAINED_COMMAND_TABLES } from '@alga-psa/db';

/**
 * A6: write-admission coverage.
 *
 * Every native write to an operational table must pass the tenantDb terminal guard (or the
 * BaseService mutationGuard). The guard sits on tenantDb builders, so the ways to slip past it
 * are the ones that do not use tenantDb: a bare `trx('table')` / `knex('table')` builder, or raw
 * SQL. This scan finds those on operational tables. A site that is correct to bypass carries
 *
 *     // write-admission: exempt — <reason>
 *
 * on the line above (or the same line). A reason is mandatory. A write is also covered when an
 * explicit `await admitOperationalWrite(db, tenant, '<table>', '<op>')` precedes it (within 60 lines),
 * which is how raw SQL and bare builders are admitted without rewriting them.
 */

const SOURCE_ROOTS = ['src', '../ee/server/src', '../packages', '../shared', '../services', '../ee/temporal-workflows/src'];
const SKIP_DIRS = new Set(['test-utils', 'node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '__tests__', '__mocks__', 'test', 'tests', 'migrations', 'seeds', 'testing']);
const SKIP_FILES = [/\.(test|spec)\.(t|j)sx?$/, /\.d\.ts$/, /\.generated\.ts$/, /\.stories\.(t|j)sx?$/, /\.contract\.test\./];

const ADMIT_WINDOW = 60;
const EXEMPT = /write-admission:\s*exempt\s*[—-]\s*\S+/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(path.join(dir, entry.name), out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !SKIP_FILES.some((re) => re.test(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const tables = Object.keys(OPERATIONAL_WRITE_TABLES);
const tableAlt = tables.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

// Raw SQL write: INSERT INTO t / UPDATE t / DELETE FROM t
const RAW_SQL = new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"?(?:public\\.)?(${tableAlt})"?\\b(?=[\\s("]|$)`, 'i');
// Bare builder: <ident>('table') ... .insert(|.update(|.del(|.delete(  within the same statement
const BARE_BUILDER = new RegExp(`\\b(?:trx|knex|db|conn|transaction|tx)\\(\\s*['"\`](${tableAlt})(?:\\s+as\\s+\\w+)?['"\`]\\s*\\)`);
const WRITE_CALL = /\.(insert|update|del|delete|truncate|increment|decrement)\s*\(/;

export interface Site { file: string; line: number; table: string; kind: 'raw-sql' | 'bare-builder' }

export function findUnguardedWriteSites(source: string, file: string): Site[] {
  const lines = source.split('\n');
  const sites: Site[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const raw = RAW_SQL.exec(text);
    const bare = BARE_BUILDER.exec(text);
    let hit: Site | null = null;
    if (raw && !/^\s*(\/\/|\*)/.test(text)) {
      // `UPDATE x` in prose/comments or error strings is not SQL; require a SQL continuation on the line or next.
      const tail = `${text} ${lines[i + 1] ?? ''}`;
      if (/\bSET\b|\bVALUES\b|\bWHERE\b|\(|\bSELECT\b|\bUSING\b|\bRETURNING\b/i.test(tail) || /INSERT\s+INTO|DELETE\s+FROM/i.test(text)) {
        hit = { file, line: i + 1, table: raw[1], kind: 'raw-sql' };
      }
    } else if (bare) {
      const window = lines.slice(i, i + 8).join('\n');
      if (WRITE_CALL.test(window)) hit = { file, line: i + 1, table: bare[1], kind: 'bare-builder' };
    }
    if (!hit) continue;
    const near = [lines[i], lines[i - 1] ?? '', lines[i - 2] ?? ''].join('\n');
    if (EXEMPT.test(near)) continue;
    // Explicit admission: `await admitOperationalWrite(db, tenant, '<table>', …)` earlier in the same scope.
    const before = lines.slice(Math.max(0, i - ADMIT_WINDOW), i + 1).join('\n');
    if (new RegExp(`admitOperationalWrite\\([^)]*['"\`]${hit.table}['"\`]`).test(before)) continue;
    sites.push(hit);
  }
  return sites;
}

describe('write-admission coverage (A6)', () => {
  it('lists the retained-command surfaces among the operational tables so they fail closed', () => {
    expect(Object.keys(OPERATIONAL_WRITE_TABLES)).toEqual(expect.arrayContaining([
      'schedule_entries', 'appointment_requests', 'online_meetings', 'comments', 'kb_articles',
    ]));
    expect(RETAINED_COMMAND_TABLES.length).toBeGreaterThan(0);
    for (const [name, entry] of Object.entries(OPERATIONAL_WRITE_TABLES)) {
      expect(entry.reason, `${name} needs a reason`).toMatch(/\S/);
    }
  });

  it('the scanner recognises the shapes it is meant to catch', () => {
    expect(findUnguardedWriteSites(`await trx('tickets').where({a:1}).update({b:2});`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx.raw('UPDATE tickets SET a = 1');`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await trx('tickets').where({a:1}).first();`, 'x.ts')).toHaveLength(0);
    expect(findUnguardedWriteSites(`// write-admission: exempt — system job\nawait trx('tickets').insert({});`, 'x.ts')).toHaveLength(0);
    expect(findUnguardedWriteSites(`await admitOperationalWrite(trx, t, 'tickets', 'x');\nawait trx.raw('UPDATE tickets SET a = 1');`, 'x.ts')).toHaveLength(0);
    expect(findUnguardedWriteSites(`await admitOperationalWrite(trx, t, 'assets', 'x');\nawait trx.raw('UPDATE tickets SET a = 1');`, 'x.ts')).toHaveLength(1);
    expect(findUnguardedWriteSites(`await tenantDb(trx, t).table('tickets').update({});`, 'x.ts')).toHaveLength(0);
  });

  it('no unannotated raw-SQL or bare-builder write reaches an operational table', () => {
    const sites = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(path.resolve(__dirname, '../../../../', root)))
      .flatMap((file) => findUnguardedWriteSites(fs.readFileSync(file, 'utf8'), path.relative(path.resolve(__dirname, '../../../../..'), file)));
    const report = sites.map((s) => `${s.file}:${s.line} [${s.kind}] ${s.table}`);
    expect(report, `Add "// write-admission: exempt — <reason>" or route through tenantDb:\n${report.join('\n')}`).toEqual([]);
  });

  it('no exemption on an operational table claims to be "NOT covered" at runtime', () => {
    const offenders = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(path.resolve(__dirname, '../../../../', root)))
      .filter((file) => /write-admission:\s*exempt[^\n]*NOT covered/i.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(path.resolve(__dirname, '../../../../..'), file));
    expect(offenders).toEqual([]);
  });
});
