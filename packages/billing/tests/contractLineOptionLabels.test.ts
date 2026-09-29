/**
 * Coverage for the "Add Usage" contract-line dropdown disambiguation. When a
 * (client, service) is eligible for two lines that share a name, the operator
 * must be able to tell them apart and each option must still carry its own
 * contract_line_id as the value that persists onto the usage record.
 */
import { describe, expect, it } from 'vitest';
import { buildEligibleContractLineOptions } from '../src/lib/contractLineOptionLabels';

describe('buildEligibleContractLineOptions', () => {
  it('keeps a clean base label when the name is unique', () => {
    const options = buildEligibleContractLineOptions([
      {
        client_contract_line_id: 'line-1',
        contract_line_name: 'Managed Seats',
        contract_line_type: 'Usage',
        contract_name: 'Good and Natural',
      },
    ]);
    expect(options).toEqual([{ value: 'line-1', label: 'Managed Seats (Usage)' }]);
  });

  it('disambiguates same-named lines with contract identity and distinct values', () => {
    const options = buildEligibleContractLineOptions([
      {
        client_contract_line_id: 'line-a',
        contract_line_name: 'Managed Seats',
        contract_line_type: 'Usage',
        contract_name: 'Good and Natural',
      },
      {
        client_contract_line_id: 'line-b',
        contract_line_name: 'Managed Seats',
        contract_line_type: 'Usage',
        contract_name: 'Emerald City Retainer',
      },
    ]);

    // Labels are distinct and name the contract.
    const labels = options.map((o) => o.label);
    expect(new Set(labels).size).toBe(2);
    expect(labels).toContain('Managed Seats (Usage) — Good and Natural');
    expect(labels).toContain('Managed Seats (Usage) — Emerald City Retainer');

    // Each option still resolves to its own contract_line_id (the persisted value).
    expect(options.find((o) => o.label.includes('Good and Natural'))?.value).toBe('line-a');
    expect(options.find((o) => o.label.includes('Emerald City Retainer'))?.value).toBe('line-b');
  });

  it('falls back to a short id suffix when contract names are also identical/absent', () => {
    const options = buildEligibleContractLineOptions([
      {
        client_contract_line_id: 'aaaaaaaa-1111-2222-3333-444444444444',
        contract_line_name: 'Managed Seats',
        contract_line_type: 'Usage',
        contract_name: null,
      },
      {
        client_contract_line_id: 'bbbbbbbb-1111-2222-3333-444444444444',
        contract_line_name: 'Managed Seats',
        contract_line_type: 'Usage',
        contract_name: null,
      },
    ]);

    const labels = options.map((o) => o.label);
    expect(new Set(labels).size).toBe(2);
    expect(labels).toContain('Managed Seats (Usage) — #aaaaaaaa');
    expect(labels).toContain('Managed Seats (Usage) — #bbbbbbbb');
  });
});
