import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/lib/api/services/ProductCatalogService.ts'),
  'utf8',
);

describe('product catalog canonical billing writes', () => {
  it('writes canonical usage billing_method for product create/update paths', () => {
    expect(source).toContain("billing_method: 'usage'");
    expect(source).not.toContain("billing_method: 'per_unit'");
  });
});
