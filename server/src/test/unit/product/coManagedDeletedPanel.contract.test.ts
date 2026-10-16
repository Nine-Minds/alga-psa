import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T013 — the standalone co-managed ticket panel and its stacked children are gone and nothing imports them.
const root = join(__dirname, '../../../../..');
const DELETED = ['CoManagedTicketPanel', 'CoManagedTicketEditor', 'CoManagedTicketConversation', 'CoManagedTicketAssignment', 'CoManagedTicketSla'];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.next-review', 'dist'].includes(name)) continue;
    const path = join(dir, name);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (stat.isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('coManagedDeletedPanel.contract.test.ts')) out.push(path);
  }
  return out;
}

describe('deleted co-managed ticket panel components', () => {
  it('no longer exist on disk', () => {
    for (const name of DELETED) expect(existsSync(join(root, 'server/src/components/co-managed', `${name}.tsx`))).toBe(false);
  });
  it('are not imported anywhere', () => {
    const pattern = new RegExp(`(?:from|import\\()\\s*['"][^'"]*/(?:${DELETED.join('|')})['"]`);
    const offenders = ['server/src', 'packages', 'ee/server', 'ee/temporal-workflows/src']
      .filter(dir => existsSync(join(root, dir)))
      .flatMap(dir => sources(join(root, dir)))
      .filter(file => pattern.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
