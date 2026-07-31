import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getClientBillingCycleAnchor } from '@shared/billingClients/billingSchedule';
import {
  materializeContractCadenceServicePeriodsForContractLine,
} from './contractCadenceServicePeriodMaterialization';
import {
  regenerateClientCadenceServicePeriodsForScheduleChange,
  retireFutureClientCadenceRowsForLine,
} from '@alga-psa/shared/billingClients';

type LiveContractLineCadenceRow = {
  contract_line_id: string;
  cadence_owner: 'client' | 'contract' | null;
  owner_client_id: string | null;
};

async function loadLiveContractLineCadenceRow(
  trx: Knex.Transaction,
  params: { tenant: string; contractLineId: string },
): Promise<LiveContractLineCadenceRow | null> {
  const db = tenantDb(trx, params.tenant);
  const query = db.table('contract_lines as cl');
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id', { type: 'left' });

  const row = await query
    .andWhere('cl.contract_line_id', params.contractLineId)
    .first(
      'cl.contract_line_id as contract_line_id',
      'cl.cadence_owner as cadence_owner',
      'ct.owner_client_id as owner_client_id',
    ) as LiveContractLineCadenceRow | undefined;

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
  const lineIds = await tenantDb(trx, params.tenant).table('contract_lines')
    .where({ contract_id: params.contractId })
    .pluck('contract_line_id');

  for (const contractLineId of lineIds) {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: params.tenant,
      contractLineId,
      sourceRunPrefix: params.sourceRunPrefix,
    });
  }
}
