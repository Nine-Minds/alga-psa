import fs from 'fs';
import path from 'path';

describe('api controller product access coverage', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  it('runs product API guard during base authenticate() for unavoidable enforcement', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/controllers/ApiBaseController.ts'),
      'utf8',
    );

    const authenticateBlock = source.slice(
      source.indexOf('protected async authenticate'),
      source.indexOf('protected async checkPermission'),
    );

    expect(authenticateBlock).toContain('await this.assertProductApiAccess(apiRequest);');
  });

  it('keeps overridden PSA-only controllers on authenticate(req) path', () => {
    const controllerPaths = [
      'server/src/lib/api/controllers/ApiProjectController.ts',
      'server/src/lib/api/controllers/ApiFinancialController.ts',
      'server/src/lib/api/controllers/ApiInvoiceController.ts',
      'server/src/lib/api/controllers/ApiQuoteController.ts',
      'server/src/lib/api/controllers/ApiTagController.ts',
      'server/src/lib/api/controllers/ApiClientController.ts',
    ];

    for (const controllerPath of controllerPaths) {
      const source = fs.readFileSync(path.join(repoRoot, controllerPath), 'utf8');
      expect(source).toContain('await this.authenticate(req)');
    }
  });

  it('keeps asset controller on explicit tenant product gate path', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/controllers/ApiAssetController.ts'),
      'utf8',
    );

    expect(source).toContain('resolveProductApiBehavior(productCode, pathname);');
    expect(source).toContain('const context = await this.requireAllowedContext(req);');
  });
});
