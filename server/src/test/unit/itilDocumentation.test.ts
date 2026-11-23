/**
 * T236, T237 — F137, F138 of `ee/plans/2026-11-21-itil-remediation` (`docs`).
 *
 * The old ITIL guide described a feature set that was never built: columns, endpoints, services
 * and workflows that do not exist. The rewritten one is checked against the repository — every
 * file, table, column and function it names has to be there — so it cannot drift back into
 * fiction without a test failing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const DOC = path.join(REPO_ROOT, 'docs/itil/itil-integration.md');
const doc = fs.readFileSync(DOC, 'utf8');

/** The prose, without fenced examples: shell and SQL samples are not claims about symbols. */
const prose = doc.replace(/```[\s\S]*?```/g, '');

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

/** Every migration, in one string: a column exists when a migration writes its name. */
const migrations = (() => {
  const dir = path.join(REPO_ROOT, 'server/migrations');
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.cjs'))
    .map((entry) => fs.readFileSync(path.join(dir, entry), 'utf8'))
    .join('\n');
})();

/** Source files the doc's function names may be declared in. */
const sources = (() => {
  const roots = ['packages', 'server/src', 'server/migrations', 'shared', 'ee/server/src', 'ee/packages', 'services'];
  const skip = new Set(['node_modules', 'dist', '.next', 'build', '__snapshots__', 'coverage']);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|cjs|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  for (const root of roots) {
    const full = path.join(REPO_ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }
  return files;
})();

describe('ITIL documentation', () => {
  it('T236: every file the doc names exists', () => {
    const paths = backticked(doc).filter((token) => /^[\w./-]+\.(ts|tsx|cjs|mjs|sql|md|json)$/.test(token));
    expect(paths.length).toBeGreaterThan(10);

    const missing = paths.filter((relative) => !fs.existsSync(path.join(REPO_ROOT, relative)));
    expect(missing).toEqual([]);
  });

  it('T236: every table and column the doc names exists in a migration', () => {
    // The data-model table: `| `table` | `col`, `col` | description |`.
    const rows = [...doc.matchAll(/^\|\s*`(\w+)`\s*\|\s*([^|]+)\|/gm)];
    const named = rows.filter(([, table]) => /^[a-z_]+$/.test(table));
    expect(named.length).toBeGreaterThan(10);

    const tables = new Set(named.map(([, table]) => table));
    const pairs = new Set<string>();
    for (const [, table, columns] of named) {
      for (const column of backticked(columns)) pairs.add(`${table}.${column}`);
    }

    // Dotted references in the prose, so a column named only in a sentence is checked too.
    // Workflow action names share the shape (`tickets.create`) and are not columns.
    const workflowActions = new Set(['tickets.create', 'tickets.update_fields', 'assets.create_maintenance_ticket']);
    for (const token of backticked(prose)) {
      const match = /^([a-z_]+)\.([a-z][a-z0-9_]*)$/.exec(token);
      if (match && tables.has(match[1]) && !workflowActions.has(token)) pairs.add(token);
    }

    const missingTables = [...tables].filter((table) => !migrations.includes(`'${table}'`));
    expect(missingTables).toEqual([]);

    const missingColumns = [...pairs].filter((pair) => {
      const column = pair.split('.')[1];
      if (column === '—') return false;
      return !new RegExp(`\\b${column}\\b`).test(migrations);
    });
    expect(missingColumns).toEqual([]);
  });

  it('T236: every function the doc names is declared in the repository', () => {
    const names = backticked(prose)
      .filter((token) => /^[A-Za-z][\w.]*\(\)$/.test(token))
      .map((token) => token.replace(/\(\)$/, '').split('.').pop() as string);
    expect(new Set(names).size).toBeGreaterThan(10);

    const undeclared = [...new Set(names)].filter((name) => {
      const declaration = new RegExp(`(?:function|const|async)\\s+${name}\\b`);
      return !sources.some((file) => declaration.test(fs.readFileSync(file, 'utf8')));
    });
    expect(undeclared).toEqual([]);
  });

  it('T236: the doc no longer claims what was never built', () => {
    // The fictions the old guide carried: endpoints, columns and a service that do not exist.
    for (const fiction of [
      '/api/itil/',
      'itilService',
      'ItilFields',
      'autoCategorizeTicket',
      'itil_category',
      'sla_breach',
      'escalation_level',
      'related_problem_id',
    ]) {
      // Word-bounded: `itil_category_remap` is a real table, `itil_category` was never a column.
      const claim = new RegExp(`${fiction.replace(/[/\\]/g, '\\$&')}(?![\\w/])`);
      expect(claim.test(doc), `the doc must not promise ${fiction}`).toBe(false);
    }
  });

  it('T237: docs/itil holds one document and nothing links to the old plan path', () => {
    expect(fs.readdirSync(path.join(REPO_ROOT, 'docs/itil'))).toEqual(['itil-integration.md']);
    expect(fs.existsSync(path.join(REPO_ROOT, 'docs/archive/ITIL_Integration_Plan.md'))).toBe(true);

    const docsRoot = path.join(REPO_ROOT, 'docs');
    const markdown: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) markdown.push(full);
      }
    };
    walk(docsRoot);

    const linking = markdown.filter((file) => fs.readFileSync(file, 'utf8').includes('itil/ITIL_Integration_Plan'));
    expect(linking.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });
});
