import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export const SYSTEM_MANAGED_DEFAULT_CONTRACT_NAME = 'System-managed default contract';
export const SYSTEM_MANAGED_DEFAULT_CONTRACT_DESCRIPTION =
  'Created automatically for uncontracted work';

export type EnsureDefaultContractForClientParams = {
  tenant: string;
  clientId: string;
};

export type EnsureDefaultContractForClientResult = {
  contractId: string;
  clientContractId: string;
  createdContract: boolean;
  createdAssignment: boolean;
};

export type EnsureDefaultContractFallbackResult = {
  ensured: boolean;
  result?: EnsureDefaultContractForClientResult;
};

type DefaultContractEnsureLogOutcome = 'created' | 'reused' | 'skipped_no_billing_configuration';

const logDefaultContractEnsure = (
  outcome: DefaultContractEnsureLogOutcome,
  payload: {
    tenant: string;
    clientId: string;
    contractId?: string;
    clientContractId?: string;
    createdContract?: boolean;
    createdAssignment?: boolean;
  },
): void => {
  console.info('[default_contract.ensure]', {
    event: 'default_contract.ensure',
    outcome,
    tenant: payload.tenant,
    clientId: payload.clientId,
    contractId: payload.contractId,
    clientContractId: payload.clientContractId,
    createdContract: payload.createdContract ?? false,
    createdAssignment: payload.createdAssignment ?? false,
    metric: {
      name:
        outcome === 'created'
          ? 'default_contract_created'
          : outcome === 'reused'
            ? 'default_contract_reused'
            : 'default_contract_skipped_no_billing_configuration',
      value: 1,
    },
  });
};

const isUniqueViolation = (error: unknown): boolean => {
  const code = (error as { code?: string } | undefined)?.code;
  return code === '23505';
};

const isKnexTransaction = (
  knexOrTrx: Knex | Knex.Transaction
): knexOrTrx is Knex.Transaction => {
  return (
    typeof (knexOrTrx as any).commit === 'function' &&
    typeof (knexOrTrx as any).rollback === 'function'
  );
};

async function findExistingDefaultContract(
  trx: Knex.Transaction,
  params: EnsureDefaultContractForClientParams
): Promise<{ contract_id: string; contract_name?: string | null; contract_description?: string | null } | null> {
  const rows = await trx('contracts')
    .where({
      tenant: params.tenant,
      owner_client_id: params.clientId,
      is_system_managed_default: true,
    })
    .select('contract_id', 'contract_name', 'contract_description', 'is_template');

  const row = rows.find((candidate: { is_template?: boolean | null }) => candidate.is_template !== true);
  return row ? { contract_id: row.contract_id as string } : null;
}

async function ensureClientContractAssignment(
  trx: Knex.Transaction,
  params: EnsureDefaultContractForClientParams & { contractId: string }
): Promise<{ clientContractId: string; createdAssignment: boolean }> {
  const existing = await trx('client_contracts')
    .where({
      tenant: params.tenant,
      client_id: params.clientId,
      contract_id: params.contractId,
    })
    .select('client_contract_id')
    .first();

  if (existing?.client_contract_id) {
    return { clientContractId: existing.client_contract_id, createdAssignment: false };
  }

  const now = new Date().toISOString();
  const clientContractId = uuidv4();

  await trx('client_contracts').insert({
    tenant: params.tenant,
    client_contract_id: clientContractId,
    client_id: params.clientId,
    contract_id: params.contractId,
    start_date: now,
    end_date: null,
    is_active: true,
    created_at: now,
    updated_at: now,
  });

  return { clientContractId, createdAssignment: true };
}

async function ensureDefaultContractForClientInTransaction(
  trx: Knex.Transaction,
  params: EnsureDefaultContractForClientParams
): Promise<EnsureDefaultContractForClientResult> {
  const client = await trx('clients')
    .where({ tenant: params.tenant, client_id: params.clientId })
    .select('client_id', 'default_currency_code')
    .first();
  if (!client?.client_id) {
    throw new Error(`Client ${params.clientId} not found`);
  }

  let existing = await findExistingDefaultContract(trx, params);
  let createdContract = false;
  let contractId = existing?.contract_id;

  if (!contractId) {
    const now = new Date().toISOString();
    const nextContractId = uuidv4();
    const currencyCode =
      typeof client.default_currency_code === 'string' && client.default_currency_code.trim().length > 0
        ? client.default_currency_code.trim().toUpperCase()
        : 'USD';

    try {
      await trx('contracts').insert({
        tenant: params.tenant,
        contract_id: nextContractId,
        contract_name: SYSTEM_MANAGED_DEFAULT_CONTRACT_NAME,
        contract_description: SYSTEM_MANAGED_DEFAULT_CONTRACT_DESCRIPTION,
        billing_frequency: 'monthly',
        currency_code: currencyCode,
        is_active: true,
        status: 'active',
        is_template: false,
        owner_client_id: params.clientId,
        is_system_managed_default: true,
        created_at: now,
        updated_at: now,
      });
      contractId = nextContractId;
      createdContract = true;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      existing = await findExistingDefaultContract(trx, params);
      if (!existing?.contract_id) {
        throw error;
      }
      contractId = existing.contract_id;
    }
  }

  if (!contractId) {
    throw new Error(`Unable to ensure default contract for client ${params.clientId}`);
  }

  if (
    existing?.contract_id === contractId &&
    (
      existing.contract_name !== SYSTEM_MANAGED_DEFAULT_CONTRACT_NAME ||
      (existing.contract_description ?? null) !== SYSTEM_MANAGED_DEFAULT_CONTRACT_DESCRIPTION
    )
  ) {
    await trx('contracts')
      .where({
        tenant: params.tenant,
        contract_id: contractId,
      })
      .update({
        contract_name: SYSTEM_MANAGED_DEFAULT_CONTRACT_NAME,
        contract_description: SYSTEM_MANAGED_DEFAULT_CONTRACT_DESCRIPTION,
        updated_at: new Date().toISOString(),
      });
  }

  const { clientContractId, createdAssignment } = await ensureClientContractAssignment(trx, {
    ...params,
    contractId,
  });

  return {
    contractId,
    clientContractId,
    createdContract,
    createdAssignment,
  };
}

export async function ensureDefaultContractForClient(
  knexOrTrx: Knex | Knex.Transaction,
  params: EnsureDefaultContractForClientParams
): Promise<EnsureDefaultContractForClientResult> {
  if (isKnexTransaction(knexOrTrx)) {
    const result = await ensureDefaultContractForClientInTransaction(knexOrTrx, params);
    logDefaultContractEnsure(
      result.createdContract || result.createdAssignment ? 'created' : 'reused',
      {
        tenant: params.tenant,
        clientId: params.clientId,
        contractId: result.contractId,
        clientContractId: result.clientContractId,
        createdContract: result.createdContract,
        createdAssignment: result.createdAssignment,
      },
    );
    return result;
  }

  return (knexOrTrx as Knex).transaction(async (trx) => {
    const result = await ensureDefaultContractForClientInTransaction(trx, params);
    logDefaultContractEnsure(
      result.createdContract || result.createdAssignment ? 'created' : 'reused',
      {
        tenant: params.tenant,
        clientId: params.clientId,
        contractId: result.contractId,
        clientContractId: result.clientContractId,
        createdContract: result.createdContract,
        createdAssignment: result.createdAssignment,
      },
    );
    return result;
  });
}

export async function ensureDefaultContractForClientIfBillingConfigured(
  knexOrTrx: Knex | Knex.Transaction,
  params: EnsureDefaultContractForClientParams
): Promise<EnsureDefaultContractFallbackResult> {
  const billingSettings = await knexOrTrx('client_billing_settings')
    .where({ tenant: params.tenant, client_id: params.clientId })
    .select('client_id')
    .first();

  if (!billingSettings?.client_id) {
    logDefaultContractEnsure('skipped_no_billing_configuration', {
      tenant: params.tenant,
      clientId: params.clientId,
    });
    return { ensured: false };
  }

  const result = await ensureDefaultContractForClient(knexOrTrx, params);
  return { ensured: true, result };
}
