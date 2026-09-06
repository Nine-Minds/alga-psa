import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  listProductSeedFiles,
  normalizeProductCode,
  resolveProductBootstrap,
  resolveProductSeedDirectory,
} from '../product-bootstrap-resolver.js';

describe('product bootstrap resolver', () => {
  it('defaults missing product code to PSA', () => {
    expect(normalizeProductCode()).toBe('psa');
    expect(resolveProductBootstrap(null)).toEqual({
      productCode: 'psa',
      seedDirectoryName: 'psa',
    });
  });

  it('resolves each product to its own seed directory', () => {
    const root = '/tmp/onboarding-seeds';

    expect(resolveProductSeedDirectory({ onboardingSeedsRoot: root, productCode: 'psa' })).toBe(
      path.join(root, 'psa'),
    );
    expect(resolveProductSeedDirectory({ onboardingSeedsRoot: root, productCode: 'algadesk' })).toBe(
      path.join(root, 'algadesk'),
    );
    expect(resolveProductSeedDirectory({ onboardingSeedsRoot: root, productCode: 'co_managed' })).toBe(
      path.join(root, 'co_managed'),
    );
  });

  it('selects the operational co-managed seed manifest without commercial bootstrap', async () => {
    const root = path.resolve(__dirname, '../../../../server/seeds/onboarding');
    const files = await listProductSeedFiles({ onboardingSeedsRoot: root, productCode: 'co_managed' });
    expect(files).toEqual([
      '01_roles.cjs', '02_permissions.cjs', '03_role_permissions.cjs',
      '06_project_task_statuses.cjs', '07_ad_to_m365_project_template.cjs',
      '08_document_folder_templates.cjs', '09_asset_type_registry.cjs',
    ]);
  });

  it('fails clearly for unsupported product codes', () => {
    expect(() => normalizeProductCode('unknown')).toThrow(
      'Unsupported tenant product code "unknown" for onboarding bootstrap',
    );
  });

  it('lists sorted CJS seed files from the selected product directory only', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alga-product-bootstrap-'));
    await fs.mkdir(path.join(root, 'psa'));
    await fs.mkdir(path.join(root, 'algadesk'));
    await fs.writeFile(path.join(root, 'psa', '02_second.cjs'), '');
    await fs.writeFile(path.join(root, 'psa', '01_first.cjs'), '');
    await fs.writeFile(path.join(root, 'psa', 'README.md'), '');
    await fs.writeFile(path.join(root, 'algadesk', '03_algadesk.cjs'), '');

    await expect(listProductSeedFiles({ onboardingSeedsRoot: root, productCode: 'psa' })).resolves.toEqual([
      '01_first.cjs',
      '02_second.cjs',
    ]);
    await expect(listProductSeedFiles({ onboardingSeedsRoot: root, productCode: 'algadesk' })).resolves.toEqual([
      '03_algadesk.cjs',
    ]);
  });
});
