import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const controllerPath = path.resolve(
  __dirname,
  '../../../lib/api/controllers/ApiMetadataController.ts',
);

describe('ApiMetadataController product filtering contract', () => {
  it('filters endpoints and openapi paths using product visibility checks', () => {
    const source = readFileSync(controllerPath, 'utf8');

    expect(source).toContain('const visibleEndpoints = validatedResult.data.endpoints.filter');
    expect(source).toContain('isApiVisibleInMetadata(productCode, endpoint.path)');
    expect(source).toContain('const filteredPaths = Object.fromEntries');
    expect(source).toContain('isApiVisibleInMetadata(productCode, apiPath)');
    expect(source).toContain('filterOpenApiSchemasByVisiblePaths');
    expect(source).toContain("refValue?.startsWith('#/components/schemas/')");
  });

  it('filters permissions and stats payloads by product-aware visibility', () => {
    const source = readFileSync(controllerPath, 'utf8');

    expect(source).toContain('filterPermissionsForProduct(');
    expect(source).toContain('filterStatsForProduct(');
    expect(source).toContain('totalPermissions: visiblePermissions.length');
  });
});
