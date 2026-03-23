import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contractCadenceSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts'),
  'utf8',
);
const clientCadenceSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/clientCadenceScheduleRegeneration.ts'),
  'utf8',
);
const recurringAdminSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/recurringServicePeriodActions.ts'),
  'utf8',
);

describe('system-managed default recurring exclusion wiring', () => {
  it('T024: system-managed default contracts never materialize recurring service periods or appear as schedulable recurring obligations', () => {
    expect(contractCadenceSource).toContain("whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false)");
    expect(clientCadenceSource).toContain("whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false)");

    expect(recurringAdminSource).toContain('context.is_system_managed_default');
    expect(recurringAdminSource).toContain('System-managed default contracts are attribution-only and cannot be managed in recurring service period admin tools.');
    expect(recurringAdminSource).toContain(".where((builder: any) =>");
    expect(recurringAdminSource).toContain("builder.whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false)");
  });
});
