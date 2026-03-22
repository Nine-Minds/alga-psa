import { describe, expect, it } from 'vitest';
import type { IContract, IContractWithClient } from './contract.interfaces';

type ExpectedOwnerClientField = string | null | undefined;
type ContractOwnerFieldMatches =
  IContract['owner_client_id'] extends ExpectedOwnerClientField ? true : false;
type ContractWithClientOwnerFieldMatches =
  IContractWithClient['owner_client_id'] extends ExpectedOwnerClientField ? true : false;

const ownerClientContractChecks = {
  contractOwnerFieldMatches: true as ContractOwnerFieldMatches,
  contractWithClientOwnerFieldMatches: true as ContractWithClientOwnerFieldMatches,
};

describe('Contract owner client typing contract', () => {
  it('T002: exposes owner_client_id on contract interfaces used by billing loaders and actions', () => {
    const ownedContract: IContract = {
      tenant: 'tenant-1',
      contract_id: 'contract-1',
      contract_name: 'Client-Owned Contract',
      owner_client_id: 'client-1',
      billing_frequency: 'monthly',
      currency_code: 'USD',
      is_active: true,
      status: 'draft',
    };

    const nullableOwnerContract: IContractWithClient = {
      ...ownedContract,
      owner_client_id: null,
    };

    expect(ownedContract.owner_client_id).toBe('client-1');
    expect(nullableOwnerContract.owner_client_id).toBeNull();
    expect(ownerClientContractChecks.contractOwnerFieldMatches).toBe(true);
    expect(ownerClientContractChecks.contractWithClientOwnerFieldMatches).toBe(true);
  });
});
