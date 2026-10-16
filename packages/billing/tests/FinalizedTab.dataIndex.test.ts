// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('FinalizedTab auto-pay column identity', () => {
  it('uses a dataIndex that is unique among its invoice columns', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/components/billing-dashboard/invoicing/FinalizedTab.tsx'), 'utf8');
    const columnStart = source.indexOf('const columns:');
    const columnSource = source.slice(columnStart, source.indexOf('\n  ];', columnStart));
    const autopayDataIndex = source.match(/export const FINALIZED_AUTOPAY_DATA_INDEX = '([^']+)'/)?.[1];
    expect(autopayDataIndex).toBeTruthy();
    expect(columnSource.match(/dataIndex: FINALIZED_AUTOPAY_DATA_INDEX/g)).toHaveLength(1);
    expect([...columnSource.matchAll(/dataIndex: ['"]([^'"]+)['"]/g)].map(match => match[1])).not.toContain(autopayDataIndex);
  });
});
