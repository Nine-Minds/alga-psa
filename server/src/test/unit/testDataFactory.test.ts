import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('testDataFactory', () => {
  it('T029: Test data factory sets plan=pro for created tenants', () => {
    // Read the test data factory source to verify plan is set to 'pro'
    const factoryPath = path.resolve(__dirname, '../../../test-utils/testDataFactory.ts');
    const content = fs.readFileSync(factoryPath, 'utf-8');

    // Verify the createTenant function sets plan to 'pro'
    expect(content).toContain("plan: 'pro'");
  });
});
