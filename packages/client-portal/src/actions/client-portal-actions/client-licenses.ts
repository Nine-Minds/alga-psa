'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
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
 * marker (stripe_sub:), so MSP-internal contracts aren't exposed.
 */
export const getClientLicenses = withAuth(
  async (user: IUserWithRoles): Promise<ClientLicenseContractSummary[]> => {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) return [];

    const scopedDb = tenantDb(knex, tenant);

    // Resolve the portal user's client_id from their contact (the user object
    // does not carry client_id directly).
    if (!user.contact_id) return [];
    const contact = await scopedDb.table('contacts')
      .where({ contact_name_id: user.contact_id })
      .first('client_id');
    const clientId = contact?.client_id as string | undefined;
    if (!clientId) return [];

    const rowsQuery = scopedDb.table('client_contracts as cc')
      .where({ 'cc.client_id': clientId })
      .whereRaw("c.contract_description LIKE '%stripe_sub:%'")
      .select(
        'cc.client_contract_id as clientContractId',
        'cc.contract_id as contractId',
        'c.contract_name as contractName',
        'c.contract_description as contractDescription',
        'cc.start_date as startDate',
        'cc.end_date as endDate',
        'cc.is_active as isActive',
        'cc.renewal_mode as renewalMode',
        'da.document_id as licenseDocumentId'
      )
      .orderBy('cc.start_date', 'desc');
    scopedDb.tenantJoin(rowsQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');
    scopedDb.tenantJoin(rowsQuery, 'document_associations as da', 'da.entity_id', 'c.contract_id', {
      type: 'left',
      on(join) {
        join.andOnVal('da.entity_type', 'contract');
      },
    });
    const rows = await rowsQuery;

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
  }
);
