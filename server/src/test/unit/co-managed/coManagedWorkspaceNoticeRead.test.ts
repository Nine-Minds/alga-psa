import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The server layout is the only caller; it must read co-managed tables only for
// a co_managed product, so psa and algadesk never touch them.
describe('msp layout notice read', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/app/msp/layout.tsx'), 'utf8');

  it("guards the read on productCode === 'co_managed'", () => {
    expect(source).toMatch(/productCode === 'co_managed'\s*\n?\s*\? await getCoManagedWorkspaceState\(\)/);
    expect(source).toMatch(/: null;/);
  });

  it('an unavailable read is no notice, never a blocked shell', () => {
    expect(source).toContain('.catch(() => null)');
    expect(source).not.toMatch(/getCoManagedWorkspaceState\(\)\s*;/);
  });
});
