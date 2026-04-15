import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../../../test-utils/billingTestHelpers.ts'),
  'utf8'
);

describe('billingTestHelpers concurrent assignment fixture support', () => {
  it('T049: createFixedPlanAssignment exposes explicit contract-header and assignment lifecycle knobs', () => {
    expect(source).toContain('interface CreateFixedPlanOptions {');
    expect(source).toContain('contractHeaderIsActive?: boolean;');
    expect(source).toContain('contractHeaderStatus?: string;');
    expect(source).toContain('assignmentIsActive?: boolean;');
    expect(source).toContain('assignmentStatus?: string;');
    expect(source).toContain('assignmentPoRequired?: boolean;');
    expect(source).toContain('assignmentPoNumber?: string | null;');
    expect(source).toContain('assignmentPoAmount?: number | null;');
    expect(source).toContain('clientContractLineIsActive?: boolean;');

    expect(source).toContain('is_active: contractHeaderIsActive');
    expect(source).toContain('status: contractHeaderStatus');
    expect(source).toContain('is_active: assignmentIsActive');
    expect(source).toContain('status: assignmentStatus');
    expect(source).toContain('po_required: assignmentPoRequired');
    expect(source).toContain('po_number: assignmentPoNumber');
    expect(source).toContain('po_amount: assignmentPoAmount');
    expect(source).toContain('is_active: clientContractLineIsActive');
  });

  it('T049: helper includes a concurrent assignment seeding utility with explicit multi-row intent', () => {
    expect(source).toContain('export async function createConcurrentFixedPlanAssignments(');
    expect(source).toContain('if (assignments.length < 2) {');
    expect(source).toContain("throw new Error('createConcurrentFixedPlanAssignments requires at least two assignments')");
    expect(source).toContain('seededAssignments.push(await createFixedPlanAssignment(context, serviceId, {');
    expect(source).toContain("startDate: '2025-02-01'");
    expect(source).toContain('assignmentIsActive: true,');
  });
});
