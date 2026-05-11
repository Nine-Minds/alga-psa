import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../../../..');

describe('tenant creation product bootstrap wiring', () => {
  it('passes tenant creation productCode to run_onboarding_seeds', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'ee/temporal-workflows/src/workflows/shared/tenant-creation-steps.ts'),
      'utf8',
    );

    expect(source).toContain('run_onboarding_seeds(input: {');
    expect(source).toContain('const seedsResult = await activities.run_onboarding_seeds({');
    expect(source).toContain('tenantId: tenantResult.tenantId');
    expect(source).toContain('productCode: input.productCode');
  });

  it('Algadesk bootstrap seed source excludes PSA-only roles and permission domains', () => {
    const algadeskSeedDir = path.join(repoRoot, 'ee/server/seeds/onboarding/algadesk');
    const seedSource = fs
      .readdirSync(algadeskSeedDir)
      .filter(file => file.endsWith('.cjs'))
      .map(file => fs.readFileSync(path.join(algadeskSeedDir, file), 'utf8'))
      .join('\n');

    for (const forbiddenRole of ['Finance', 'Project Manager', 'Dispatcher', 'Technician']) {
      expect(seedSource).not.toContain(`role_name: '${forbiddenRole}'`);
    }

    for (const forbiddenResource of [
      'asset',
      'billing',
      'billing_settings',
      'contract',
      'credit',
      'invoice',
      'project',
      'project_task',
      'service',
      'timeentry',
      'timesheet',
      'workflow',
    ]) {
      expect(seedSource).not.toContain(`['${forbiddenResource}'`);
      expect(seedSource).not.toContain(`'${forbiddenResource}:`);
    }
  });
});
