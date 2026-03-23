import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const clientContractsTabSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/components/billing-dashboard/contracts/ClientContractsTab.tsx'),
  'utf8',
);
const contractDetailSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx'),
  'utf8',
);

describe('system-managed default attribution-only UI wiring', () => {
  it('T022: list/detail surfaces show attribution-only semantics and block line/cadence/pricing/assignment-date authoring controls', () => {
    expect(clientContractsTabSource).toContain('System-managed default');
    expect(clientContractsTabSource).toContain('Attribution-only. Created automatically for uncontracted work.');

    expect(contractDetailSource).toContain('System-managed default contract');
    expect(contractDetailSource).toContain('This contract is attribution-only and does not control recurring billing behavior.');
    expect(contractDetailSource).toContain('To configure custom billing behavior, create or edit a normal user-authored contract.');

    expect(contractDetailSource).toContain('<TabsTrigger value="lines" disabled={isSystemManagedDefault}>Contract Lines</TabsTrigger>');
    expect(contractDetailSource).toContain('<TabsTrigger value="pricing" disabled={isSystemManagedDefault}>Pricing Schedules</TabsTrigger>');
    expect(contractDetailSource).toContain('id={`edit-assignment-${assignment.client_contract_id}`}');
    expect(contractDetailSource).toContain('disabled={isSystemManagedDefault}');
    expect(contractDetailSource).toContain('id={`assignment-start-date-${assignment.client_contract_id}`}');
    expect(contractDetailSource).toContain('id={`assignment-end-date-${assignment.client_contract_id}`}');
    expect(contractDetailSource).toContain('isReadOnly={isSystemManagedDefault}');
  });
});
