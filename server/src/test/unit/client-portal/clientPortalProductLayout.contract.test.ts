import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('Client portal product layout contracts', () => {
  it('resolves tenant product in the server client-portal layout', () => {
    const source = read('src/app/client-portal/layout.tsx');
    expect(source).toContain('getCurrentTenantProduct');
    expect(source).toContain('productCode={productCode}');
  });

  it('threads product code into client portal shell + sidebar', () => {
    const source = read('../packages/client-portal/src/components/layout/ClientPortalLayout.tsx');
    expect(source).toContain('data-product-shell={productCode}');
    expect(source).toContain('productCode={productCode}');
  });
});

