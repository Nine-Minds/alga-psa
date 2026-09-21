import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import { tenantDb } from '@alga-psa/db';

const tenantScopedTable = (db: Knex | Knex.Transaction, table: string, tenant: string, lock = false): Knex.QueryBuilder => {
  const query = tenantDb(db, tenant).table(table);
  if (lock) query.forShare();
  return query;
};

interface DocumentAssociationRow {
  document_id: string;
  entity_id: string;
  entity_type: string;
}

interface DocumentAuthorizationInput {
  document_id: string;
  created_by?: string | null;
  is_client_visible?: boolean | null;
}

export async function resolveDocumentAuthorizationRecords(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documents: DocumentAuthorizationInput[],
  options: { lock?: boolean } = {}
): Promise<Map<string, AuthorizationRecord>> {
  if (options.lock && !trx.isTransaction) throw new Error('Document authority locks require a transaction');
  const documentIds = documents.map((doc) => doc.document_id);
  const records = new Map<string, AuthorizationRecord>();
  if (documentIds.length === 0) {
    return records;
  }

  const associations = await tenantScopedTable(trx, 'document_associations', tenant, options.lock)
    .whereIn('document_id', documentIds)
    .select<DocumentAssociationRow[]>('document_id', 'entity_id', 'entity_type');

  const associationByDocument = new Map<string, DocumentAssociationRow[]>();
  for (const association of associations) {
    const existing = associationByDocument.get(association.document_id) ?? [];
    existing.push(association);
    associationByDocument.set(association.document_id, existing);
  }

  const contactIds = new Set<string>();
  const ticketIds = new Set<string>();
  const projectTaskIds = new Set<string>();
  const contractIds = new Set<string>();
  const quoteIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const salesOrderIds = new Set<string>();

  const scopedDb = tenantDb(trx, tenant);
  for (const association of associations) {
    if (association.entity_type === 'contact') {
      contactIds.add(association.entity_id);
    }
    if (association.entity_type === 'ticket') {
      ticketIds.add(association.entity_id);
    }
    if (association.entity_type === 'project_task') {
      projectTaskIds.add(association.entity_id);
    }
    if (association.entity_type === 'contract') {
      contractIds.add(association.entity_id);
    }
    if (association.entity_type === 'quote') {
      quoteIds.add(association.entity_id);
    }
    if (association.entity_type === 'invoice') {
      invoiceIds.add(association.entity_id);
    }
    if (association.entity_type === 'sales_order') {
      salesOrderIds.add(association.entity_id);
    }
  }

  const [
    contactClientRows,
    ticketClientRows,
    projectTaskClientRows,
    contractClientRows,
    quoteClientRows,
    invoiceClientRows,
    salesOrderClientRows,
  ] = await Promise.all([
    contactIds.size > 0
      ? tenantScopedTable(trx, 'contacts', tenant, options.lock)
          .whereIn('contact_name_id', Array.from(contactIds))
          .select<{ contact_name_id: string; client_id: string | null }[]>('contact_name_id', 'client_id')
      : Promise.resolve([]),
    ticketIds.size > 0
      ? tenantScopedTable(trx, 'tickets', tenant, options.lock)
          .whereIn('ticket_id', Array.from(ticketIds))
          .select<{ ticket_id: string; client_id: string | null }[]>('ticket_id', 'client_id')
      : Promise.resolve([]),
    projectTaskIds.size > 0
      ? tenantScopedTable(trx, 'project_tasks as pt', tenant, options.lock)
          .modify((builder) => {
            scopedDb.tenantJoin(builder, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
            scopedDb.tenantJoin(builder, 'projects as p', 'pp.project_id', 'p.project_id');
          })
          .whereIn('pt.task_id', Array.from(projectTaskIds))
          .select<{ task_id: string; client_id: string | null }[]>('pt.task_id', 'p.client_id')
      : Promise.resolve([]),
    contractIds.size > 0
      ? tenantScopedTable(trx, 'client_contracts', tenant, options.lock)
          .whereIn('contract_id', Array.from(contractIds))
          .select<{ contract_id: string; client_id: string | null }[]>('contract_id', 'client_id')
      : Promise.resolve([]),
    quoteIds.size > 0
      ? tenantScopedTable(trx, 'quotes', tenant, options.lock)
          .whereIn('quote_id', Array.from(quoteIds))
          .select<{ quote_id: string; client_id: string | null }[]>('quote_id', 'client_id')
      : Promise.resolve([]),
    invoiceIds.size > 0
      ? tenantScopedTable(trx, 'invoices', tenant, options.lock)
          .whereIn('invoice_id', Array.from(invoiceIds))
          .select<{ invoice_id: string; client_id: string | null }[]>('invoice_id', 'client_id')
      : Promise.resolve([]),
    salesOrderIds.size > 0
      ? tenantScopedTable(trx, 'sales_orders', tenant, options.lock)
          .whereIn('so_id', Array.from(salesOrderIds))
          .select<{ so_id: string; client_id: string | null }[]>('so_id', 'client_id')
      : Promise.resolve([]),
  ]);

  const contactClientById = new Map<string, string | null>();
  for (const row of contactClientRows) {
    contactClientById.set(row.contact_name_id, row.client_id ?? null);
  }
  const ticketClientById = new Map<string, string | null>();
  for (const row of ticketClientRows) {
    ticketClientById.set(row.ticket_id, row.client_id ?? null);
  }
  const projectTaskClientById = new Map<string, string | null>();
  for (const row of projectTaskClientRows) {
    projectTaskClientById.set(row.task_id, row.client_id ?? null);
  }
  const contractClientIdsByContractId = new Map<string, Set<string>>();
  for (const row of contractClientRows) {
    if (!row.client_id) continue;
    let clientIds = contractClientIdsByContractId.get(row.contract_id);
    if (!clientIds) {
      clientIds = new Set<string>();
      contractClientIdsByContractId.set(row.contract_id, clientIds);
    }
    clientIds.add(row.client_id);
  }
  const quoteClientById = new Map<string, string | null>();
  for (const row of quoteClientRows) {
    quoteClientById.set(row.quote_id, row.client_id ?? null);
  }
  const invoiceClientById = new Map<string, string | null>();
  for (const row of invoiceClientRows) {
    invoiceClientById.set(row.invoice_id, row.client_id ?? null);
  }
  const salesOrderClientById = new Map<string, string | null>();
  for (const row of salesOrderClientRows) {
    salesOrderClientById.set(row.so_id, row.client_id ?? null);
  }

  for (const document of documents) {
    const documentAssociations = associationByDocument.get(document.document_id) ?? [];
    const directClientAssociations = documentAssociations.filter((association) => association.entity_type === 'client');
    const userAssociations = documentAssociations.filter((association) => association.entity_type === 'user');
    const teamAssociations = documentAssociations.filter((association) => association.entity_type === 'team');
    const contactAssociations = documentAssociations.filter((association) => association.entity_type === 'contact');
    const ticketAssociations = documentAssociations.filter((association) => association.entity_type === 'ticket');
    const projectTaskAssociations = documentAssociations.filter((association) => association.entity_type === 'project_task');
    const contractAssociations = documentAssociations.filter((association) => association.entity_type === 'contract');
    const quoteAssociations = documentAssociations.filter((association) => association.entity_type === 'quote');
    const invoiceAssociations = documentAssociations.filter((association) => association.entity_type === 'invoice');
    const salesOrderAssociations = documentAssociations.filter((association) => association.entity_type === 'sales_order');

    const ownerFromUserAssociation = userAssociations[0]?.entity_id ?? null;
    const ownerViaContactMatch =
      user.contact_id && contactAssociations.some((association) => association.entity_id === user.contact_id)
        ? user.user_id
        : null;

    // A document can be linked to multiple clients via any combination of direct
    // client, contact, ticket, project_task, contract, quote, invoice, and
    // sales_order associations. Gather every candidate client_id, then prefer the
    // viewer's own clientId when it matches so the kernel's `same_client` rule
    // authorizes the viewer.
    const candidateClientIds = new Set<string>();
    for (const association of directClientAssociations) {
      candidateClientIds.add(association.entity_id);
    }
    for (const association of contactAssociations) {
      const clientId = contactClientById.get(association.entity_id);
      if (clientId) candidateClientIds.add(clientId);
    }
    for (const association of ticketAssociations) {
      const clientId = ticketClientById.get(association.entity_id);
      if (clientId) candidateClientIds.add(clientId);
    }
    for (const association of projectTaskAssociations) {
      const clientId = projectTaskClientById.get(association.entity_id);
      if (clientId) candidateClientIds.add(clientId);
    }
    for (const association of contractAssociations) {
      const contractClientIds = contractClientIdsByContractId.get(association.entity_id);
      if (!contractClientIds) continue;
      for (const clientId of contractClientIds) {
        candidateClientIds.add(clientId);
      }
    }
    for (const association of quoteAssociations) {
      const clientId = quoteClientById.get(association.entity_id);
      if (clientId) candidateClientIds.add(clientId);
    }
    for (const association of invoiceAssociations) {
      const clientId = invoiceClientById.get(association.entity_id);
      if (clientId) candidateClientIds.add(clientId);
    }
    for (const association of salesOrderAssociations) {
      const clientId = salesOrderClientById.get(association.entity_id);
      if (clientId) candidateClientIds.add(clientId);
    }

    const clientId = user.clientId && candidateClientIds.has(user.clientId)
      ? user.clientId
      : (candidateClientIds.values().next().value ?? null);

    records.set(document.document_id, {
      id: document.document_id,
      ownerUserId: ownerFromUserAssociation ?? ownerViaContactMatch ?? document.created_by ?? null,
      assignedUserIds: Array.from(new Set(userAssociations.map((association) => association.entity_id))),
      clientId,
      teamIds: Array.from(new Set(teamAssociations.map((association) => association.entity_id))),
      is_client_visible: document.is_client_visible === true,
    });
  }

  return records;
}

