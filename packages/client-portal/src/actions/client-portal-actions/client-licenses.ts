'use server';

import { withAuth } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';

export interface ClientLicenseContractSummary {
  clientContractId: string;
  contractId: string;
  contractName: string;
  tier: string;
  transport: string;
  startDate: string;
  endDate: string | null;
  status: string;
  renewalMode: string;
  /** Document ID of the license JWT, if available */
  licenseDocumentId: string | null;
}

/**
 * Returns the license contracts for the authenticated portal user's client.
 * Only returns contracts whose description contains the appliance license
 * marker (tier: and stripe_sub:), so MSP-internal contracts aren't exposed.
 */
export async function getClientLicenses(): Promise<ClientLicenseContractSummary[]> {
  return withAuth(async (user: IUserWithRoles) => {
    const tenant = user.tenant;
    const knex = await getConnection(tenant);

    const rows = await knex('client_contracts as cc')
      .join('contracts as c', function () {
        this.on('cc.contract_id', 'c.contract_id').andOn('cc.tenant', 'c.tenant');
      })
      .leftJoin('document_associations as da', function () {
        this.on('da.entity_id', 'c.contract_id')
          .andOnVal('da.entity_type', 'contract')
          .andOn('da.tenant', 'c.tenant');
      })
      .where({
        'cc.client_id': user.client_id ?? '',
        'cc.tenant': tenant,
      })
      .whereRaw("c.contract_description LIKE '%stripe_sub:%'")
      .select(
        'cc.client_contract_id as clientContractId',
        'cc.contract_id as contractId',
        'c.contract_name as contractName',
        'c.contract_description as contractDescription',
        'cc.start_date as startDate',
        'cc.end_date as endDate',
        'cc.is_active as isActive',
        knex.raw(`COALESCE(cc.status, CASE WHEN cc.is_active THEN 'active' ELSE 'inactive' END) as status`),
        'cc.renewal_mode as renewalMode',
        'da.document_id as licenseDocumentId'
      )
      .orderBy('cc.start_date', 'desc');

    return rows.map((row: any) => {
      const desc: string = row.contractDescription ?? '';
      const tierMatch = desc.match(/tier:(\w+)/);
      const transportMatch = desc.match(/transport:(\S+)/);
      return {
        clientContractId: row.clientContractId,
        contractId: row.contractId,
        contractName: row.contractName,
        tier: tierMatch?.[1] ?? 'pro',
        transport: transportMatch?.[1] ?? 'unknown',
        startDate: row.startDate instanceof Date ? row.startDate.toISOString() : String(row.startDate),
        endDate: row.endDate ? (row.endDate instanceof Date ? row.endDate.toISOString() : String(row.endDate)) : null,
        status: row.isActive ? 'active' : 'inactive',
        renewalMode: row.renewalMode ?? 'none',
        licenseDocumentId: row.licenseDocumentId ?? null,
      };
    });
  });
}
