import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const walkFiles = (dir: string): string[] => {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    if (entry.name === 'dist') continue;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
      continue;
    }
    out.push(full);
  }
  return out;
};

describe('invoice designer repo guards', () => {
  it('does not reference removed per-property store actions', () => {
    const billingSrcDir = path.resolve(__dirname, '../../../'); // packages/billing/src
    const files = walkFiles(billingSrcDir).filter((file) => /\.(ts|tsx)$/.test(file));

    const bannedSymbols = [
      'updateNodeName',
      'updateNodeMetadata',
      'updateNodeLayout',
      'updateNodeStyle',
      'updateNodeSize',
      'setNodePosition',
      'moveNodeByDelta',
      'moveNodeToParentAtIndex',
    ];

    const bannedRegex = new RegExp(`\\b(${bannedSymbols.join('|')})\\b`, 'g');

    const offenders: Array<{ file: string; symbol: string }> = [];
    for (const file of files) {
      if (path.basename(file) === 'noLegacyApis.guard.test.ts') continue;
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.matchAll(bannedRegex);
      for (const match of matches) {
        offenders.push({ file, symbol: match[1] ?? match[0] });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('does not use legacy `childIds` hierarchy outside state modules', () => {
    const invoiceDesignerDir = path.resolve(__dirname, '..'); // packages/billing/src/components/invoice-designer
    const files = walkFiles(invoiceDesignerDir)
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => !file.includes(`${path.sep}state${path.sep}`))
      .filter((file) => !/\.test\.(ts|tsx)$/.test(file));

    const offenders: Array<{ file: string; count: number }> = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const count = (content.match(/\.childIds\b/g) ?? []).length;
      if (count > 0) {
        offenders.push({ file, count });
      }
    }

    expect(offenders).toEqual([]);
  });
});
