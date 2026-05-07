import fs from 'fs';
import path from 'path';

describe('ApiMetadataController product visibility contract', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  it('applies product access guard and filters endpoint/openapi metadata by product visibility', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/controllers/ApiMetadataController.ts'),
      'utf8',
    );

    expect(source).toContain('await this.assertProductApiAccess(apiRequest);');
    expect(source).toContain('isApiVisibleInMetadata(productCode, endpoint.path)');
    expect(source).toContain('isApiVisibleInMetadata(productCode, apiPath)');
    expect(source).toContain('totalEndpoints: visibleEndpoints.length');
  });
});
