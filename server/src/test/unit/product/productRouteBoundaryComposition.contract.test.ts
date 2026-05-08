import fs from 'fs';
import path from 'path';

describe('product route boundary composition', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  it('provides a reusable branded upgrade/not-found boundary component', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/components/product/ProductRouteBoundary.tsx'),
      'utf8',
    );

    expect(source).toContain("behavior: Extract<ProductRouteBehavior, 'upgrade_boundary' | 'not_found'>");
    expect(source).toContain('Available in Alga PSA');
    expect(source).toContain('Page not available');
    expect(source).toContain("msp: '/msp/dashboard'");
    expect(source).toContain("'client-portal': '/client-portal/dashboard'");
  });

  it('uses registry-backed route behavior guard in MSP layout', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/app/msp/MspLayoutClient.tsx'),
      'utf8',
    );

    expect(source).toContain('resolveProductRouteBehavior(productCode, pathname)');
    expect(source).toContain('<ProductRouteBoundary behavior={routeBehavior} scope="msp" />');
  });

  it('uses registry-backed route behavior guard in portal layout', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/app/client-portal/ClientPortalLayoutClient.tsx'),
      'utf8',
    );

    expect(source).toContain('resolveProductRouteBehavior(productCode, pathname)');
    expect(source).toContain('<ProductRouteBoundary behavior={routeBehavior} scope="client-portal" />');
  });
});
