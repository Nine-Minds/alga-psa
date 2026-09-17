import type { Knex } from 'knex';
import type { IDocument, IUser } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { canReadCommentAttachment, isPublicAttachmentComment } from './ticketCommentAttachments';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
  type RelationshipRule,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

// Shared by initial ticket loading and subsequent document actions.
// LEVERAGE: pattern tenant-scoped-table — document actions and shared authorization repeat this typed facade.
function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

type UserWithOptionalRoles = IUser & { roles?: Array<{ role_id?: string } | string> };

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

function extractRoleIdsFromUser(user: UserWithOptionalRoles): string[] {
  if (!Array.isArray(user.roles)) {
    return [];
  }

  return user.roles
    .map((role: { role_id?: string } | string) => {
      if (typeof role === 'string') {
        return role;
      }
      return typeof role?.role_id === 'string' ? role.role_id : null;
    })
    .filter((value: string | null): value is string => Boolean(value));
}

async function resolveAuthorizationSubjectForUser(
  trx: Knex.Transaction,
  tenant: string,
  user: UserWithOptionalRoles
): Promise<AuthorizationSubject> {
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await tenantScopedTable(trx, 'user_roles', tenant)
        .where('user_id', user.user_id)
        .select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  let teamRows: Array<{ team_id: string }> = [];
  let managedRows: Array<{ user_id: string }> = [];
  try {
    teamRows = await tenantScopedTable(trx, 'team_members', tenant)
      .where('user_id', user.user_id)
      .select<{ team_id: string }[]>('team_id');
  } catch {
    teamRows = [];
  }
  try {
    managedRows = await tenantScopedTable(trx, 'users', tenant)
      .where('reports_to', user.user_id)
      .select<{ user_id: string }[]>('user_id');
  } catch {
    managedRows = [];
  }

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

function applyDocumentRedactions<T extends object>(document: T, redactedFields: string[]): T {
  if (redactedFields.length === 0) {
    return document;
  }

  const redacted = { ...document } as Record<string, unknown>;
  for (const field of redactedFields) {
    delete redacted[field];
  }
  return redacted as T;
}

function getDocumentBuiltinRelationshipRules(user: IUser): RelationshipRule[] {
  if (user.user_type !== 'client') {
    return [];
  }

  return [{ template: 'own' }, { template: 'same_client' }];
}

async function resolveDocumentAuthorizationRecords(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documents: DocumentAuthorizationInput[]
): Promise<Map<string, AuthorizationRecord>> {
  const documentIds = documents.map((doc) => doc.document_id);
  const records = new Map<string, AuthorizationRecord>();
  if (documentIds.length === 0) {
    return records;
  }

  const associations = await tenantScopedTable(trx, 'document_associations', tenant)
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
      ? tenantScopedTable(trx, 'contacts', tenant)
          .whereIn('contact_name_id', Array.from(contactIds))
          .select<{ contact_name_id: string; client_id: string | null }[]>('contact_name_id', 'client_id')
      : Promise.resolve([]),
    ticketIds.size > 0
      ? tenantScopedTable(trx, 'tickets', tenant)
          .whereIn('ticket_id', Array.from(ticketIds))
          .select<{ ticket_id: string; client_id: string | null }[]>('ticket_id', 'client_id')
      : Promise.resolve([]),
    projectTaskIds.size > 0
      ? tenantScopedTable(trx, 'project_tasks as pt', tenant)
          .modify((builder) => {
            scopedDb.tenantJoin(builder, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
            scopedDb.tenantJoin(builder, 'projects as p', 'pp.project_id', 'p.project_id');
          })
          .whereIn('pt.task_id', Array.from(projectTaskIds))
          .select<{ task_id: string; client_id: string | null }[]>('pt.task_id', 'p.client_id')
      : Promise.resolve([]),
    contractIds.size > 0
      ? tenantScopedTable(trx, 'client_contracts', tenant)
          .whereIn('contract_id', Array.from(contractIds))
          .select<{ contract_id: string; client_id: string | null }[]>('contract_id', 'client_id')
      : Promise.resolve([]),
    quoteIds.size > 0
      ? tenantScopedTable(trx, 'quotes', tenant)
          .whereIn('quote_id', Array.from(quoteIds))
          .select<{ quote_id: string; client_id: string | null }[]>('quote_id', 'client_id')
      : Promise.resolve([]),
    invoiceIds.size > 0
      ? tenantScopedTable(trx, 'invoices', tenant)
          .whereIn('invoice_id', Array.from(invoiceIds))
          .select<{ invoice_id: string; client_id: string | null }[]>('invoice_id', 'client_id')
      : Promise.resolve([]),
    salesOrderIds.size > 0
      ? tenantScopedTable(trx, 'sales_orders', tenant)
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

export async function authorizeAndRedactDocuments<T extends IDocument>(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documents: T[],
  verifiedRecipientLifecycleAccess?: (documentId: string) => Promise<boolean>
): Promise<T[]> {
  if (documents.length === 0) {
    return [];
  }

  const authorizationSubject = await resolveAuthorizationSubjectForUser(trx, tenant, user as UserWithOptionalRoles);
  const relationshipRules = getDocumentBuiltinRelationshipRules(user);
  const selectedClientIds = user.clientId ? [user.clientId] : undefined;
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules,
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(trx, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();
  const authorizationRecords = await resolveDocumentAuthorizationRecords(
    trx,
    tenant,
    user,
    documents.map((document) => ({
      document_id: document.document_id,
      created_by: document.created_by,
      is_client_visible: document.is_client_visible,
    }))
  );

  const decisions = await Promise.all(
    documents.map(async (document) => {
      const record = authorizationRecords.get(document.document_id) ?? {
        id: document.document_id,
        ownerUserId: document.created_by ?? null,
        is_client_visible: document.is_client_visible === true,
      };

      const decision = await authorizationKernel.authorizeResource({
        subject: authorizationSubject,
        resource: {
          type: 'document',
          action: 'read',
          id: document.document_id,
        },
        record,
        selectedClientIds,
        requestCache,
        knex: trx,
      });

      const isClientVisible = record.is_client_visible === true;
      const isOwnedBySubject = record.ownerUserId === authorizationSubject.userId;
      const deniedByClientVisibility =
        user.user_type === 'client' && !isOwnedBySubject && !isClientVisible;
      const allowed = decision.allowed && !deniedByClientVisibility &&
        await (verifiedRecipientLifecycleAccess ? verifiedRecipientLifecycleAccess(document.document_id) : canReadCommentAttachment(trx, tenant, user.user_id, document.document_id));

      return {
        allowed,
        redactedFields: decision.redactedFields,
      };
    })
  );

  const authorizedDocuments: T[] = [];
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const decision = decisions[index];
    if (!document || !decision?.allowed) {
      continue;
    }
    const attachment = await tenantDb(trx, tenant).table('ticket_comment_attachments')
      .where({ document_id: document.document_id }).first();
    const annotated = attachment ? { ...document, comment_attachment_is_public:
      attachment.state === 'attached' && Boolean(attachment.comment_id) &&
      await isPublicAttachmentComment(trx, tenant, attachment.comment_id, attachment.ticket_id),
    } : document;
    authorizedDocuments.push(applyDocumentRedactions(annotated, decision.redactedFields));
  }

  return authorizedDocuments;
}

