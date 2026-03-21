import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const clientContractsTabPath = path.resolve(
  process.cwd(),
  '../packages/billing/src/components/billing-dashboard/contracts/ClientContractsTab.tsx',
);
const contractDetailPath = path.resolve(
  process.cwd(),
  '../packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx',
);

describe('system-managed default contract list/detail guards', () => {
  it('T010: client contracts list includes system-managed badge/helper and hides destructive lifecycle actions', () => {
    const source = fs.readFileSync(clientContractsTabPath, 'utf8');

    expect(source).toContain('System-managed default');
    expect(source).toContain('Created automatically for uncontracted work');
    expect(source).toContain('const isSystemManagedDefault = record.is_system_managed_default === true;');
    expect(source).toContain('!isSystemManagedDefault && (record.assignment_status ?? record.status) === \'active\'');
    expect(source).toContain('!isSystemManagedDefault && (record.assignment_status ?? record.status) === \'terminated\'');
    expect(source).toContain('!isSystemManagedDefault && (record.assignment_status ?? record.status) === \'draft\'');
    expect(source).toContain('{!isSystemManagedDefault ? (');
    expect(source).toContain('id="client-contracts-tab-delete-menu-item"');
  });

  it('T010: contract detail includes system-managed explanatory copy and read-only ownership/lifecycle controls', () => {
    const source = fs.readFileSync(contractDetailPath, 'utf8');

    expect(source).toContain('const isSystemManagedDefault = contract?.is_system_managed_default === true;');
    expect(source).toContain('data-testid="system-managed-default-contract-alert"');
    expect(source).toContain('Created automatically for uncontracted work.');
    expect(source).toContain('Ownership is system-managed for this default contract.');
    expect(source).toContain('disabled={isSystemManagedDefault}');
    expect(source).toContain('disabled={isSaving || isSystemManagedDefault}');
    expect(source).toContain('{!isSystemManagedDefault ? (');
    expect(source).toContain('id="delete-contract-btn"');
  });
});
