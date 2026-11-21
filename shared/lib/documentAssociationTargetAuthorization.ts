import type { Knex } from 'knex';
import type { IUser, IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth';
import { createAssetReadContext, filterReadableAssets, resolveAuthorizationSubjectForUser } from '@alga-psa/authorization/assetReadAuthorization';
import { compileResourceReadAuthorizationSql, type BundleNarrowingRule, type RelationshipSqlAdapter } from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { createProjectReadAuthorizer } from '../../packages/projects/src/lib/projectReadAuthorization';
import { canAccessAttachmentTicket } from './ticketCommentAttachments';
import { authorizeAndRedactDocumentsForAction } from './documentAuthorization';
import { getClientContactVisibilityContext } from '@alga-psa/authorization/portal/visibility.server';
import { applyTicketVisibilityFilter } from '@alga-psa/authorization/portal/visibility';

type AssociationSearchEntity = 'client' | 'contact' | 'ticket' | 'asset' | 'project_task' | 'contract' | 'opportunity' | 'quote';
type AssociationTargetEntity = AssociationSearchEntity | 'invoice' | 'sales_order' | 'user' | 'team' | 'tenant' | 'document';
type TargetAction = 'read' | 'create' | 'update';

type SearchScope = (query: Knex.QueryBuilder, conn: Knex.Transaction, tenant: string, user: IUser, alias: string) => Promise<void>;
type TargetCheck = (conn: Knex.Transaction, tenant: string, user: IUser, entityId: string, action: TargetAction) => Promise<boolean>;
type AssociationOwnerInput = { entity_id: string; entity_type: string };

interface AssociationTargetAdapter {
  permissionResource: string;
  scopeSearch?: SearchScope;
  assertTarget: TargetCheck;
}

const dbTable = (conn: Knex.Transaction, tenant: string, table: string) => tenantDb(conn, tenant).table(table);
const associationKey = (entityType: string, entityId: string) => `${entityType}:${entityId}`;

/** Shared entity-to-client mapping for both target checks and document relationship records. */
export async function resolveAssociationTargetClientIds(
  conn: Knex.Transaction,
  tenant: string,
  associations: readonly AssociationOwnerInput[],
): Promise<Map<string, string[]>> {
  const idsByType = new Map<string, Set<string>>();
  for (const association of associations) {
    if (!['client', 'contact', 'ticket', 'project_task', 'contract', 'quote', 'invoice', 'sales_order', 'opportunity', 'asset'].includes(association.entity_type)) continue;
    const ids = idsByType.get(association.entity_type) ?? new Set<string>();
    ids.add(association.entity_id);
    idsByType.set(association.entity_type, ids);
  }
  const select = (type: string) => Array.from(idsByType.get(type) ?? []);
  const scopedDb = tenantDb(conn, tenant);
  const [clients, contacts, tickets, tasks, contracts, quotes, invoices, salesOrders, opportunities, assets] = await Promise.all([
    select('client').length ? dbTable(conn, tenant, 'clients').whereIn('client_id', select('client')).select('client_id') : Promise.resolve([]),
    select('contact').length ? dbTable(conn, tenant, 'contacts').whereIn('contact_name_id', select('contact')).select('contact_name_id', 'client_id') : Promise.resolve([]),
    select('ticket').length ? dbTable(conn, tenant, 'tickets').whereIn('ticket_id', select('ticket')).select('ticket_id', 'client_id') : Promise.resolve([]),
    select('project_task').length ? dbTable(conn, tenant, 'project_tasks as pt').modify((builder) => {
      scopedDb.tenantJoin(builder, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
      scopedDb.tenantJoin(builder, 'projects as p', 'pp.project_id', 'p.project_id');
    }).whereIn('pt.task_id', select('project_task')).select('pt.task_id', 'p.client_id') : Promise.resolve([]),
    select('contract').length ? dbTable(conn, tenant, 'client_contracts').whereIn('contract_id', select('contract')).select('contract_id', 'client_id') : Promise.resolve([]),
    select('quote').length ? dbTable(conn, tenant, 'quotes').whereIn('quote_id', select('quote')).select('quote_id', 'client_id') : Promise.resolve([]),
    select('invoice').length ? dbTable(conn, tenant, 'invoices').whereIn('invoice_id', select('invoice')).select('invoice_id', 'client_id') : Promise.resolve([]),
    select('sales_order').length ? dbTable(conn, tenant, 'sales_orders').whereIn('so_id', select('sales_order')).select('so_id', 'client_id') : Promise.resolve([]),
    select('opportunity').length ? dbTable(conn, tenant, 'opportunities').whereIn('opportunity_id', select('opportunity')).select('opportunity_id', 'client_id') : Promise.resolve([]),
    select('asset').length ? dbTable(conn, tenant, 'assets').whereIn('asset_id', select('asset')).select('asset_id', 'client_id') : Promise.resolve([]),
  ]);
  const result = new Map<string, string[]>();
  for (const row of clients as Array<{ client_id: string }>) result.set(associationKey('client', row.client_id), [row.client_id]);
  const addRows = (type: string, rows: Array<Record<string, string | null>>, idField: string) => {
    for (const row of rows) if (row[idField]) result.set(associationKey(type, row[idField]!), row.client_id ? [row.client_id] : []);
  };
  addRows('contact', contacts as Array<Record<string, string | null>>, 'contact_name_id');
  addRows('ticket', tickets as Array<Record<string, string | null>>, 'ticket_id');
  addRows('project_task', tasks as Array<Record<string, string | null>>, 'task_id');
  addRows('quote', quotes as Array<Record<string, string | null>>, 'quote_id');
  addRows('invoice', invoices as Array<Record<string, string | null>>, 'invoice_id');
  addRows('sales_order', salesOrders as Array<Record<string, string | null>>, 'so_id');
  addRows('opportunity', opportunities as Array<Record<string, string | null>>, 'opportunity_id');
  addRows('asset', assets as Array<Record<string, string | null>>, 'asset_id');
  for (const row of contracts as Array<{ contract_id: string; client_id: string | null }>) {
    const key = associationKey('contract', row.contract_id);
    const existing = result.get(key) ?? [];
    if (row.client_id && !existing.includes(row.client_id)) existing.push(row.client_id);
    result.set(key, existing);
  }
  return result;
}

async function hasTargetPermission(user: IUser, resource: string, action: TargetAction, conn: Knex.Transaction): Promise<boolean> {
  // Attaching a document changes the association set, not the target record itself.
  // Existing target authorizers model that operation as update when no create action
  // exists for an established record type.
  return hasPermission(user, resource, action === 'create' ? 'update' : action, conn);
}

async function clientOwns(conn: Knex.Transaction, tenant: string, user: IUser, clientId: string | null | undefined): Promise<boolean> {
  return user.user_type !== 'client' || Boolean(user.clientId && clientId && user.clientId === clientId);
}

function directClientScope(column: string): SearchScope {
  return async (query, _conn, _tenant, user, _alias) => {
    if (user.user_type === 'client') query.where(column, user.clientId ?? '__no_client_scope__');
  };
}

async function ticketScope(query: Knex.QueryBuilder, conn: Knex.Transaction, tenant: string, user: IUser, alias: string): Promise<void> {
  if (user.user_type !== 'client') return;
  query.where(`${alias}.client_id`, user.clientId ?? '__no_client_scope__');
  if (!user.contact_id) {
    query.whereRaw('1 = 0');
    return;
  }
  try {
    const visibility = await getClientContactVisibilityContext(conn, tenant, user.contact_id);
    if (!user.clientId || visibility.clientId !== user.clientId) {
      query.whereRaw('1 = 0');
      return;
    }
    applyTicketVisibilityFilter(query, visibility, {
      boardColumn: `${alias}.board_id`,
      contactColumn: `${alias}.contact_name_id`,
    });
  } catch {
    // Visibility metadata failures must narrow search to no tickets.
    query.whereRaw('1 = 0');
  }
}

async function applyKernelReadScope(
  query: Knex.QueryBuilder,
  conn: Knex.Transaction,
  tenant: string,
  user: IUser,
  resourceType: 'project' | 'asset',
  sqlAdapter: RelationshipSqlAdapter,
): Promise<void> {
  const subject = await resolveAuthorizationSubjectForUser(conn, tenant, user as IUserWithRoles);
  const input = { subject, resource: { type: resourceType, action: 'read' } };
  let bundleRules: BundleNarrowingRule[];
  try {
    bundleRules = await resolveBundleNarrowingRulesForEvaluation(conn, input);
  } catch {
    // Match the existing record authorizers: bundle resolution failures do not
    // invent a new denial policy for association search.
    bundleRules = [];
  }
  const result = compileResourceReadAuthorizationSql(query, {
    resourceType,
    action: 'read',
    builtinRules: user.user_type === 'client' ? [{ template: 'same_client' }] : [],
    bundleRules,
    ctx: { subject, adapter: sqlAdapter },
  });
  if (!result.supported) query.whereRaw('1 = 0');
}

async function projectTaskSearchScope(query: Knex.QueryBuilder, conn: Knex.Transaction, tenant: string, _user: IUser, _alias: string): Promise<void> {
  // Project task authorization is project authorization, evaluated against the
  // owning project record. Keep that predicate in SQL before both count and page.
  query.whereNotNull('p.project_id');
  const adapter: RelationshipSqlAdapter = {
    ownerColumn: 'p.assigned_to',
    clientColumn: 'p.client_id',
    boardColumn: 'p.project_id',
    teamColumn: 'p.project_id',
    applyAssignedUsers: (builder, userIds) => builder.whereIn('p.assigned_to', userIds),
    applyOwner: (builder, userId) => builder.where('p.assigned_to', userId),
    // Project authorization records currently contain no teamIds; the kernel
    // therefore denies same_team rules for projects.
    applyTeams: (builder) => builder.whereRaw('1 = 0'),
    // Project records do not carry a board id, so selected_boards also denies.
    applyBoards: (builder) => builder.whereRaw('1 = 0'),
  };
  await applyKernelReadScope(query, conn, tenant, _user, 'project', adapter);
}

async function assetSearchScope(query: Knex.QueryBuilder, conn: Knex.Transaction, tenant: string, user: IUser, alias: string): Promise<void> {
  const associationsFor = (builder: Knex.QueryBuilder, entityType: 'user' | 'team', ids: string[]) => {
    const associations = dbTable(conn, tenant, 'asset_associations as aa')
      .whereRaw('?? = ??', ['aa.tenant', `${alias}.tenant`])
      .whereRaw('?? = ??', ['aa.asset_id', `${alias}.asset_id`])
      .where('aa.entity_type', entityType)
      .whereIn('aa.entity_id', ids);
    builder.whereExists(associations.select(conn.raw('1')));
  };
  const ownerAssociation = dbTable(conn, tenant, 'asset_associations as owner')
    .whereRaw('?? = ??', ['owner.tenant', `${alias}.tenant`])
    .whereRaw('?? = ??', ['owner.asset_id', `${alias}.asset_id`])
    .where('owner.entity_type', 'user')
    .select('owner.entity_id')
    .orderBy('owner.entity_id', 'asc')
    .limit(1);
  const applyOwner = (builder: Knex.QueryBuilder, userId: string) => {
    const owner = dbTable(conn, tenant, 'asset_associations as aa')
      .whereRaw('?? = ??', ['aa.tenant', `${alias}.tenant`])
      .whereRaw('?? = ??', ['aa.asset_id', `${alias}.asset_id`])
      .where('aa.entity_type', 'user')
      .where('aa.entity_id', userId)
      .whereIn('aa.entity_id', ownerAssociation)
      .select(conn.raw('1'));
    builder.whereExists(owner);
  };
  const adapter: RelationshipSqlAdapter = {
    ownerColumn: `${alias}.asset_id`,
    clientColumn: `${alias}.client_id`,
    boardColumn: `${alias}.asset_id`,
    teamColumn: `${alias}.asset_id`,
    applyAssignedUsers: (builder, ids) => associationsFor(builder, 'user', ids),
    applyOwner,
    applyTeams: (builder, ids) => associationsFor(builder, 'team', ids),
    // Asset authorization records do not carry a board id.
    applyBoards: (builder) => builder.whereRaw('1 = 0'),
  };
  await applyKernelReadScope(query, conn, tenant, user, 'asset', adapter);
}

async function assertOwnedRecord(
  conn: Knex.Transaction,
  tenant: string,
  user: IUser,
  action: TargetAction,
  resource: string,
  loadClientId: () => Promise<string | null | undefined>,
): Promise<boolean> {
  if (!await hasTargetPermission(user, resource, action, conn)) return false;
  const clientId = await loadClientId();
  return clientId !== undefined && await clientOwns(conn, tenant, user, clientId);
}

const adapters: Record<AssociationTargetEntity, AssociationTargetAdapter> = {
  client: {
    permissionResource: 'client',
    scopeSearch: directClientScope('client_id'),
    assertTarget: (conn, tenant, user, id, action) => assertOwnedRecord(conn, tenant, user, action, 'client', async () => {
      const row = await dbTable(conn, tenant, 'clients').select('client_id').where({ client_id: id }).first();
      return row?.client_id;
    }),
  },
  contact: {
    permissionResource: 'contact',
    scopeSearch: directClientScope('c.client_id'),
    assertTarget: (conn, tenant, user, id, action) => assertOwnedRecord(conn, tenant, user, action, 'contact', async () => {
      const row = await dbTable(conn, tenant, 'contacts').select('client_id').where({ contact_name_id: id }).first();
      return row?.client_id;
    }),
  },
  ticket: {
    permissionResource: 'ticket',
    scopeSearch: ticketScope,
    assertTarget: async (conn, tenant, user, id, action) => {
      if (!await hasTargetPermission(user, 'ticket', action, conn)) return false;
      const row = await dbTable(conn, tenant, 'tickets').select('client_id').where({ ticket_id: id }).first();
      if (!row || !await clientOwns(conn, tenant, user, row.client_id)) return false;
      return user.user_type !== 'client' || canAccessAttachmentTicket(conn, tenant, user.user_id, id);
    },
  },
  asset: {
    permissionResource: 'asset',
    scopeSearch: assetSearchScope,
    assertTarget: async (conn, tenant, user, id, action) => {
      if (!await hasTargetPermission(user, 'asset', action, conn)) return false;
      const row = await dbTable(conn, tenant, 'assets').select('asset_id', 'client_id').where({ asset_id: id }).first();
      if (!row || !await clientOwns(conn, tenant, user, row.client_id)) return false;
      // Asset writes follow the existing asset mutation rule: coarse update
      // permission does not bypass the per-record asset read policy.
      const context = await createAssetReadContext(conn, tenant, user);
      return (await filterReadableAssets(conn, tenant, context, [row])).length === 1;
    },
  },
  project_task: {
    permissionResource: 'project',
    scopeSearch: projectTaskSearchScope,
    assertTarget: async (conn, tenant, user, id, action) => {
      // The catalog exposes task permissions to MSP roles; portal roles manage
      // tasks through project permissions. Both still require the owning
      // project's record policy and client scope below.
      const resource = user.user_type === 'client' ? 'project' : 'project_task';
      if (!await hasTargetPermission(user, resource, action, conn)) return false;
      const row = await dbTable(conn, tenant, 'project_tasks as pt')
        .leftJoin('project_phases as pp', function joinPhase() {
          this.on('pt.phase_id', '=', 'pp.phase_id').andOn('pt.tenant', '=', 'pp.tenant');
        })
        .leftJoin('projects as p', function joinProject() {
          this.on('pp.project_id', '=', 'p.project_id').andOn('pp.tenant', '=', 'p.tenant');
        })
        .select('p.project_id', 'p.client_id', 'p.assigned_to')
        .where('pt.task_id', id).first();
      if (!row?.project_id || !await clientOwns(conn, tenant, user, row.client_id)) return false;
      const authorizeProject = await createProjectReadAuthorizer(conn, tenant, user as IUserWithRoles, action === 'create' ? 'update' : action);
      return authorizeProject(row);
    },
  },
  contract: {
    permissionResource: 'billing',
    scopeSearch: async (query, _conn, _tenant, user) => {
      if (user.user_type === 'client') query.where('cc.client_id', user.clientId ?? '__no_client_scope__');
    },
    assertTarget: async (conn, tenant, user, id, action) => {
      if (!await hasTargetPermission(user, 'billing', action, conn)) return false;
      const contract = await dbTable(conn, tenant, 'contracts').select('contract_id').where({ contract_id: id }).first();
      if (!contract) return false;
      if (user.user_type !== 'client') return true;
      if (!user.clientId) return false;
      const clientIdsByTarget = await resolveAssociationTargetClientIds(conn, tenant, [{ entity_type: 'contract', entity_id: id }]);
      const clientIds = clientIdsByTarget.get(associationKey('contract', id)) ?? [];
      // Contract documents reach every assigned client. A client's assignment
      // permits reading, but mutations must not publish to or detach for others.
      return clientIds.includes(user.clientId) &&
        (action === 'read' || clientIds.every((clientId) => clientId === user.clientId));
    },
  },
  opportunity: {
    permissionResource: 'opportunities',
    scopeSearch: directClientScope('o.client_id'),
    assertTarget: (conn, tenant, user, id, action) => assertOwnedRecord(conn, tenant, user, action, 'opportunities', async () => {
      const row = await dbTable(conn, tenant, 'opportunities').select('client_id').where({ opportunity_id: id }).first();
      return row?.client_id;
    }),
  },
  quote: {
    permissionResource: 'billing',
    scopeSearch: directClientScope('q.client_id'),
    assertTarget: (conn, tenant, user, id, action) => assertOwnedRecord(conn, tenant, user, action, 'billing', async () => {
      const row = await dbTable(conn, tenant, 'quotes').select('client_id').where({ quote_id: id }).first();
      return row?.client_id;
    }),
  },
  invoice: {
    permissionResource: 'invoice',
    assertTarget: (conn, tenant, user, id, action) => assertOwnedRecord(conn, tenant, user, action, 'invoice', async () => {
      const row = await dbTable(conn, tenant, 'invoices').select('client_id').where({ invoice_id: id }).first();
      return row?.client_id;
    }),
  },
  sales_order: {
    permissionResource: 'sales_order',
    assertTarget: (conn, tenant, user, id, action) => assertOwnedRecord(conn, tenant, user, action, 'sales_order', async () => {
      const row = await dbTable(conn, tenant, 'sales_orders').select('client_id').where({ so_id: id }).first();
      return row?.client_id;
    }),
  },
  user: {
    permissionResource: 'user',
    assertTarget: async (conn, tenant, user, id, action) => {
      if (!await hasTargetPermission(user, 'user', action, conn)) return false;
      const row = await dbTable(conn, tenant, 'users as u')
        .leftJoin('contacts as c', function joinContact() { this.on('u.contact_id', '=', 'c.contact_name_id').andOn('u.tenant', '=', 'c.tenant'); })
        .select('u.user_id', 'c.client_id').where('u.user_id', id).first();
      return Boolean(row && (user.user_type !== 'client' ? true : id === user.user_id || await clientOwns(conn, tenant, user, row.client_id)));
    },
  },
  team: {
    permissionResource: 'team',
    assertTarget: async (conn, tenant, user, id, action) => user.user_type !== 'client' &&
      await hasTargetPermission(user, 'team', action, conn) &&
      Boolean(await dbTable(conn, tenant, 'teams').select('team_id').where({ team_id: id }).first()),
  },
  tenant: {
    permissionResource: 'tenant',
    assertTarget: async (_conn, tenant, user, id) => user.user_type !== 'client' && id === tenant,
  },
  document: {
    permissionResource: 'document',
    assertTarget: async (conn, tenant, user, id, action) => {
      if (!await hasTargetPermission(user, 'document', action, conn)) return false;
      const rows = await dbTable(conn, tenant, 'documents').where({ document_id: id }).select('document_id', 'created_by', 'is_client_visible');
      return (await authorizeAndRedactDocumentsForAction(conn, tenant, user, rows as any, action === 'read' ? 'read' : 'update')).length === 1;
    },
  },
};

export async function applyAssociationTargetSearchScope(
  query: Knex.QueryBuilder,
  conn: Knex.Transaction,
  tenant: string,
  user: IUser,
  entityType: AssociationSearchEntity,
  alias: string,
): Promise<boolean> {
  const adapter = adapters[entityType];
  if (!adapter || !await hasTargetPermission(user, adapter.permissionResource, 'read', conn)) return false;
  await adapter.scopeSearch?.(query, conn, tenant, user, alias);
  return true;
}

export async function assertAuthorizedAssociationTarget(
  conn: Knex.Transaction,
  tenant: string,
  user: IUser,
  entityType: string,
  entityId: string,
  action: TargetAction,
): Promise<boolean> {
  const adapter = adapters[entityType as AssociationTargetEntity];
  // Unknown target kinds fail closed for every principal; a document grant cannot
  // substitute for target authorization.
  return Boolean(adapter && entityId && await adapter.assertTarget(conn, tenant, user, entityId, action));
}
