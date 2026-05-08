import fs from 'fs';
import path from 'path';

describe('ApiBaseController product access contract', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  it('adds centralized product-api guard and structured denied error', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/controllers/ApiBaseController.ts'),
      'utf8',
    );

    expect(source).toContain("class ProductDeniedApiError extends Error");
    expect(source).toContain("code = 'PRODUCT_ACCESS_DENIED'");
    expect(source).toContain('resolveProductApiBehavior(productCode, pathname)');
    expect(source).toContain("if (behavior === 'denied')");
    expect(source).toContain('await this.assertProductApiAccess(apiRequest);');
  });
});
