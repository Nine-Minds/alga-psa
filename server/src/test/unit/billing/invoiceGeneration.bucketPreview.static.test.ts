import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const invoiceGenerationSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../packages/billing/src/actions/invoiceGeneration.ts',
  ),
  'utf8',
);

describe('invoice generation bucket preview rendering', () => {
  it('renders usage bucket overages as service units instead of hours', () => {
    expect(invoiceGenerationSource).toContain('charge.isUsageBucket');
    expect(invoiceGenerationSource).toContain('unitOfMeasure');
    expect(invoiceGenerationSource).toContain('${unitLabel} used');
    expect(invoiceGenerationSource).toContain('${unitLabel} included');
    expect(invoiceGenerationSource).toContain('${unitLabel} overage');
  });
});
