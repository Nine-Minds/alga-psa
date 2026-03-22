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
const billingAndTaxSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/billingAndTax.ts'),
  'utf8',
);
const recurringAdminSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/recurringServicePeriodActions.ts'),
  'utf8',
);
const contractLineActionsSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/contractLineAction.ts'),
  'utf8',
);
const contractLineMappingActionsSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/contractLineMappingActions.ts'),
  'utf8',
);
const contractPricingScheduleActionsSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/contractPricingScheduleActions.ts'),
  'utf8',
);
const contractLineServiceConfigurationActionsSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/contractLineServiceConfigurationActions.ts'),
  'utf8',
);
const billingClientsActionsSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/billingClientsActions.ts'),
  'utf8',
);
const contractLinesUiSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/components/billing-dashboard/contracts/ContractLines.tsx'),
  'utf8',
);
const pricingSchedulesUiSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/components/billing-dashboard/contracts/PricingSchedules.tsx'),
  'utf8',
);

describe('system-managed default attribution-shell cutover wiring', () => {
  it('F072/F085: excludes system-managed defaults from recurring materialization and due-work/admin recurring schedule authority paths', () => {
    expect(contractCadenceSource).toContain("whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false)");
    expect(clientCadenceSource).toContain("whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false)");
    expect(billingAndTaxSource).toContain("where('rsp.obligation_type', 'contract_line')");
    expect(billingAndTaxSource).toContain("where('rsp.obligation_type', CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE)");
    expect(billingAndTaxSource).toContain("whereNull('ct.is_system_managed_default').orWhere('ct.is_system_managed_default', false)");
    expect(recurringAdminSource).toContain('context.is_system_managed_default');
    expect(recurringAdminSource).toContain('attribution-only and cannot be managed in recurring service period admin tools');
  });

  it('F071/F073: backend mutation paths block authoring for system-managed default contracts', () => {
    expect(contractLineActionsSource).toContain('assertContractLineIsAuthorable');
    expect(contractLineActionsSource).toContain('contract-line authoring is disabled');
    expect(contractLineMappingActionsSource).toContain('assertContractIsAuthorable');
    expect(contractLineMappingActionsSource).toContain('contract-line authoring is disabled');
    expect(contractPricingScheduleActionsSource).toContain('pricing schedule authoring is disabled');
    expect(contractLineServiceConfigurationActionsSource).toContain('contract-line service configuration authoring is disabled');
    expect(billingClientsActionsSource).toContain('assignment lifecycle and date edits are disabled');
    expect(billingClientsActionsSource).toContain('manual assignment authoring is disabled');
  });

  it('F073/F074: contract line and pricing schedule UI surfaces become read-only with attribution-only guidance', () => {
    expect(contractLinesUiSource).toContain('isReadOnly?: boolean;');
    expect(contractLinesUiSource).toContain('isReadOnly = false');
    expect(contractLinesUiSource).toContain('attribution-only. Contract line authoring is disabled.');
    expect(contractLinesUiSource).toContain('disabled={isReadOnly}');

    expect(pricingSchedulesUiSource).toContain('isReadOnly?: boolean;');
    expect(pricingSchedulesUiSource).toContain('isReadOnly = false');
    expect(pricingSchedulesUiSource).toContain('attribution-only. Pricing schedule authoring is disabled.');
    expect(pricingSchedulesUiSource).toContain('disabled={isReadOnly}');
  });
});
