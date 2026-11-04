// T026: static guards for the warranty/RMA feature (C5).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '../../../..');
const inv = join(repo, 'packages/inventory/src');

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.git'].includes(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue; // dangling symlink
    }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

const rmaLibFiles = readdirSync(join(inv, 'lib/rma'))
  .filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f))
  .map((f) => join(inv, 'lib/rma', f));
const guarded = [...rmaLibFiles, join(inv, 'actions/rmaWarrantyActions.ts')];

// Modules under packages/inventory/src/lib that write stock movements/levels/units.
const STOCK_WRITER_MODULES = [
  'movements', 'adjust', 'levels', 'receive', 'consume', 'allocation', 'counts', 'materials', 'reconcile',
  'staging', 'stagingContainers', 'purchaseOrders', 'ghostUsage', 'openingBalanceCsv', 'stockConflict',
];

describe('warranty/RMA static guards (T026)', () => {
  it('finds the guarded files', () => {
    expect(rmaLibFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(guarded.map((f) => [f.replace(repo + '/', ''), f]))('%s never touches the stock ledger', (_n, file) => {
    const src = stripComments(readFileSync(file, 'utf8'));
    expect(src).not.toMatch(/recordStockMovement/);
    expect(src).not.toMatch(/stock_movements|stock_levels|stock_units/);
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of imports) {
      const last = spec.split('/').pop()!.replace(/\.(js|ts)$/, '');
      const isStockWriter =
        (spec.startsWith('.') && STOCK_WRITER_MODULES.includes(last)) ||
        /@alga-psa\/inventory\/.*(movements|adjust|levels)/.test(spec);
      expect(isStockWriter, `${spec} imported by ${file}`).toBe(false);
    }
  });

  it('labelPrintClient.ts is gone and nothing imports or mentions it', () => {
    const offenders: string[] = [];
    for (const root of ['packages', 'server/src', 'shared', 'ee/server/src', 'ee/packages', 'services']) {
      const dir = join(repo, root);
      if (!existsSync(dir)) continue;
      for (const f of walk(dir)) {
        if (/labelPrintClient/.test(f)) offenders.push(`file: ${f}`);
        else if (/labelPrintClient/.test(readFileSync(f, 'utf8'))) offenders.push(`ref: ${f}`);
      }
    }
    // The files that assert this (this one) mention the name; exclude self.
    expect(offenders.filter((o) => !o.endsWith('warrantyRma.static.test.ts'))).toEqual([]);
  });
});
