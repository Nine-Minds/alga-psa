import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TICKET_DIR = path.resolve(__dirname, '../../components/ticket');

// Pure type guards: they read a returned value and never call into the server.
const PURE_GUARDS = new Set(['isTeamActionError', 'isTagActionError']);

// The Grid timeline tile is deliberately outside this seam (it is replaced wholesale by a later
// layer); it keeps its direct action imports until then.
const OUT_OF_SEAM = new Set(['bento/BentoTimelineTile.tsx']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const IMPORT_RE = /import\s+(?!type\b)([^;]*?)\s+from\s+['"]([^'"]+)['"]/gs;
const isActionModule = (spec: string) => /(^|\/)actions(\/|$)/.test(spec);

describe('ticket screen seam coverage', () => {
  const files = walk(TICKET_DIR);

  it('scans the ticket components', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no runtime import from an action module in components/ticket (type-only imports and pure guards allowed)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(TICKET_DIR, file);
      if (OUT_OF_SEAM.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(IMPORT_RE)) {
        const [, clause, spec] = match;
        if (!isActionModule(spec)) continue;
        const names = clause
          .replace(/[{}]/g, '')
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part && !part.startsWith('type '))
          .map((part) => part.split(/\s+as\s+/)[0].trim());
        const runtime = names.filter((name) => !PURE_GUARDS.has(name));
        if (runtime.length > 0) offenders.push(`${rel}: ${runtime.join(', ')} from ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no component branches on the data source kind', () => {
    const branching = files
      .filter((file) => /dataSource\.kind|\.kind\s*(===|!==)\s*['"]/.test(readFileSync(file, 'utf8')))
      .filter((file) => !file.endsWith('TicketDataSourceContext.tsx'))
      .map((file) => path.relative(TICKET_DIR, file));
    expect(branching).toEqual([]);
  });
});
