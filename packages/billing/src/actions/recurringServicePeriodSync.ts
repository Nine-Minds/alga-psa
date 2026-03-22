import type { Knex } from 'knex';
import { getClientBillingCycleAnchor } from '@shared/billingClients/billingSchedule';
import {
  materializeContractCadenceServicePeriodsForContractLine,
} from './contractCadenceServicePeriodMaterialization';
import {
  regenerateClientCadenceServicePeriodsForScheduleChange,
  retireFutureClientCadenceRowsForLine,
} from './clientCadenceScheduleRegeneration';

type LiveContractLineCadenceRow = {
  contract_line_id: string;
  cadence_owner: 'client' | 'contract' | null;
  owner_client_id: string | null;
};

async function loadLiveContractLineCadenceRow(
  trx: Knex.Transaction,
  params: { tenant: string; contractLineId: string },
): Promise<LiveContractLineCadenceRow | null> {
  const row = await trx('contract_lines as cl')
    .leftJoin('contracts as ct', function joinContracts(this: any) {
      this.on('ct.contract_id', '=', 'cl.contract_id')
        .andOn('ct.tenant', '=', 'cl.tenant');
    })
    .where('cl.tenant', params.tenant)
    .andWhere('cl.contract_line_id', params.contractLineId)
    .first(
      'cl.contract_line_id',
      'cl.cadence_owner',
      'ct.owner_client_id',
    );

  if (!row) {
    return null;
  }

  return {
    contract_line_id: row.contract_line_id,
    cadence_owner: row.cadence_owner ?? 'client',
    owner_client_id: row.owner_client_id ?? null,
  };
}

async function regenerateClientCadenceRowsForOwner(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string },
): Promise<void> {
  const schedule = await getClientBillingCycleAnchor(trx, params.tenant, params.clientId);
  await regenerateClientCadenceServicePeriodsForScheduleChange(trx, {
    tenant: params.tenant,
    clientId: params.clientId,
    billingCycle: schedule.billingCycle,
    anchor: schedule.anchor,
  });
}

export async function syncRecurringServicePeriodsForContractLine(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    contractLineId: string;
    sourceRunPrefix: string;
  },
): Promise<void> {
  const line = await loadLiveContractLineCadenceRow(trx, {
    tenant: params.tenant,
    contractLineId: params.contractLineId,
  });

  if (!line) {
    return;
  }

  await materializeContractCadenceServicePeriodsForContractLine(trx, {
    tenant: params.tenant,
    contractLineId: params.contractLineId,
    sourceRunPrefix: params.sourceRunPrefix,
  });

  if (line.cadence_owner === 'client' && line.owner_client_id) {
    await regenerateClientCadenceRowsForOwner(trx, {
      tenant: params.tenant,
      clientId: line.owner_client_id,
    });
    return;
  }

  await retireFutureClientCadenceRowsForLine(trx, {
    tenant: params.tenant,
    contractLineId: params.contractLineId,
    retiredAt: new Date().toISOString(),
  });
}

export async function syncRecurringServicePeriodsForContract(
  trx: Knex.Transaction,
  params: {
    tenant: string;
    contractId: string;
    sourceRunPrefix: string;
  },
): Promise<void> {
  const lineIds = await trx('contract_lines')
    .where({
      tenant: params.tenant,
      contract_id: params.contractId,
    })
    .pluck('contract_line_id');

  for (const contractLineId of lineIds) {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: params.tenant,
      contractLineId,
      sourceRunPrefix: params.sourceRunPrefix,
    });
  }
}
