import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contractLinesUiSource = readFileSync(
  new URL('../../clients/src/components/clients/ContractLines.tsx', import.meta.url),
  'utf8'
);
const billingConfigurationSource = readFileSync(
  new URL('../../clients/src/components/clients/BillingConfiguration.tsx', import.meta.url),
  'utf8'
);
const overlapMatrixSource = readFileSync(
  new URL('../../clients/src/components/clients/ClientServiceOverlapMatrix.tsx', import.meta.url),
  'utf8'
);

describe('Multi-active clients UI identity audit wiring', () => {
  it('T032: contract-lines assignment picker remains keyed by client_contract_id identity', () => {
    expect(contractLinesUiSource).toContain('value={selectedClientContractId ?? \'\'}');
    expect(contractLinesUiSource).toContain('value: assignment.client_contract_id!');
    expect(contractLinesUiSource).toContain('Assignment ${assignment.client_contract_id?.slice(0, 8)}');
    expect(contractLinesUiSource).not.toContain('value: assignment.contract_id');
  });

  it('T032: billing configuration state keeps selected assignment by client_contract_id', () => {
    expect(billingConfigurationSource).toContain('assignment.client_contract_id === prevSelected');
    expect(billingConfigurationSource).toContain('activeAssignments[0]?.client_contract_id ?? null');
  });

  it('T032: service overlap matrix identity remains assignment-line scoped', () => {
    expect(overlapMatrixSource).toContain('servicesMap[clientPlan.client_contract_line_id] = fullServices;');
    expect(overlapMatrixSource).toContain('serviceToPlans[service.service_id].push(clientPlan.client_contract_line_id);');
    expect(overlapMatrixSource).toContain('key={plan.client_contract_line_id}');
  });
});
