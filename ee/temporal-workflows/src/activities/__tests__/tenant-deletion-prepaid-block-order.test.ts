import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('tenant deletion prepaid block ordering', () => {
  it('deletes hour_blocks before contract_line_block_issuances (plain NO ACTION hour_blocks_issuance_fkey)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../tenant-deletion-activities.ts', import.meta.url)),
      'utf8',
    );
    const blocks = source.indexOf("  'hour_blocks',\n");
    const issuances = source.indexOf("  'contract_line_block_issuances',\n");
    expect(blocks).toBeGreaterThan(-1);
    expect(issuances).toBeGreaterThan(blocks);
  });
});
