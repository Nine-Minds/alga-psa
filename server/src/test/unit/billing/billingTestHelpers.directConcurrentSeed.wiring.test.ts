import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../../../test-utils/billingTestHelpers.ts'),
  'utf8'
);

describe('billingTestHelpers direct concurrent assignment seeding wiring', () => {
  it('T050: includes a dedicated helper that seeds concurrent assignments via direct DB fixtures', () => {
    expect(source).toContain('export async function seedConcurrentClientContractAssignmentsDirect(');
    expect(source).toContain('if (assignments.length < 2) {');
    expect(source).toContain("throw new Error('seedConcurrentClientContractAssignmentsDirect requires at least two assignments')");
    expect(source).toContain("await context.createEntity('contracts', {");
    expect(source).toContain("await context.createEntity('client_contracts', {");
    expect(source).toContain("}, 'contract_id');");
    expect(source).toContain("}, 'client_contract_id');");
  });

  it('T050: direct helper allows assignment lifecycle overrides without production write-path guards', () => {
    expect(source).toContain('interface DirectConcurrentAssignmentSeedOptions {');
    expect(source).toContain('assignmentIsActive?: boolean;');
    expect(source).toContain('assignmentStatus?: string;');
    expect(source).toContain('contractHeaderIsActive?: boolean;');
    expect(source).toContain('contractHeaderStatus?: string;');
    expect(source).toContain('const assignmentIsActive = assignment.assignmentIsActive ?? true;');
    expect(source).toContain("const assignmentStatus = assignment.assignmentStatus ?? 'active';");
  });
});
