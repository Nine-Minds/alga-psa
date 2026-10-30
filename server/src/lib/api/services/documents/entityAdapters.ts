/**
 * Per-entity behaviour for attaching a document through the shared upload core.
 *
 * Adding an attachable entity (contract, opportunity, ...) is one entry in
 * ENTITY_ADAPTERS; neither the endpoint, the core nor the MCP tool changes.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import type { IDocument } from 'server/src/interfaces/document.interface';
import { ATTACHABLE_ENTITY_TYPES } from '../../schemas/documentAttach';
import { hasPermission } from '../../../auth/rbac';
import { authorizeApiResourceRead } from '../../controllers/authorizationKernel';
import { buildProjectRecordContext, buildTicketRecordContext } from '../../controllers/recordContexts';
import { ProductAccessError, getTenantProduct } from '@/lib/productAccess';
import { resolveProductApiBehavior } from '@/lib/productSurfaceRegistry';
import {
  ForbiddenError,
  NotFoundError,
  type AuthenticatedApiRequest,
} from '../../middleware/apiMiddleware';

export { ATTACHABLE_ENTITY_TYPES };
export type AttachableEntityType = (typeof ATTACHABLE_ENTITY_TYPES)[number];

export function isAttachableEntityType(value: unknown): value is AttachableEntityType {
  return typeof value === 'string' && (ATTACHABLE_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Options only the ticket multipart route can set; the JSON endpoint never passes them. */
export interface AttachHookOptions {
  commentAttachmentDraft?: boolean;
}

export interface InTransactionArgs {
  trx: Knex.Transaction;
  tenant: string;
  actorUserId: string;
  entityId: string;
  document: IDocument;
  options: AttachHookOptions;
}

export interface EntityAdapter {
  entityType: AttachableEntityType;
  /** RBAC resource whose `update` permission is required to attach to this entity. */
  rbacResource: string;
  /**
   * API surface that represents this entity in the product-surface registry. The entity is
   * attachable for a tenant's product iff the registry allows this path for that product, so
   * availability follows the registry (algadesk: tickets/clients/contacts; PSA-only: the rest).
   */
  productApiPath: string;
  /** Throws NotFoundError / ForbiddenError. */
  assertCanAttach(apiRequest: AuthenticatedApiRequest, entityId: string, knex: Knex): Promise<void>;
  /** Folder the document is filed in, or undefined for none. */
  resolveFolder(knex: Knex, tenant: string, entityId: string): Promise<string | undefined>;
  /** Extra columns for the `documents` row (e.g. client visibility for comment-attachment drafts). */
  documentOverrides?(options: AttachHookOptions): Partial<IDocument> & { is_client_visible?: boolean };
  /** Runs inside the document transaction, after the document and association rows are inserted. */
  inTransaction?(args: InTransactionArgs): Promise<void>;
}

/**
 * Rejects an entity that the tenant's product does not expose, with the same error the
 * product gate raises elsewhere (403 PRODUCT_ACCESS_DENIED).
 */
export async function assertEntityAvailableForProduct(
  adapter: EntityAdapter,
  tenant: string,
): Promise<void> {
  const productCode = await getTenantProduct(tenant);
  if (resolveProductApiBehavior(productCode, adapter.productApiPath) === 'denied') {
    throw new ProductAccessError(`api_route:${adapter.productApiPath}`, productCode);
  }
}

async function assertRbacUpdate(
  apiRequest: AuthenticatedApiRequest,
  resource: string,
  knex: Knex,
): Promise<void> {
  const allowed = await hasPermission(apiRequest.context.user, resource, 'update', knex);
  if (!allowed) {
    throw new ForbiddenError(`Permission denied: Cannot update ${resource}`);
  }
}

async function assertRowExists(
  knex: Knex,
  tenant: string,
  table: string,
  idColumn: string,
  id: string,
  label: string,
): Promise<void> {
  const row = await tenantDb(knex, tenant).table(table).where({ [idColumn]: id }).select(idColumn).first();
  if (!row) {
    throw new NotFoundError(`${label} not found`);
  }
}

async function firstEntityFolder(
  knex: Knex,
  tenant: string,
  entityType: string,
  entityId: string,
): Promise<string | undefined> {
  const folder = await tenantDb(knex, tenant)
    .table('document_folders')
    .where({ entity_id: entityId, entity_type: entityType })
    .orderBy('folder_path', 'asc')
    .select('folder_path')
    .first();
  return folder?.folder_path ?? undefined;
}

/** Simple entities: RBAC update + existence, filed under their first entity folder. */
function simpleAdapter(
  entityType: AttachableEntityType,
  rbacResource: string,
  productApiPath: string,
  table: string,
  idColumn: string,
  label: string,
): EntityAdapter {
  return {
    entityType,
    rbacResource,
    productApiPath,
    async assertCanAttach(apiRequest, entityId, knex) {
      await assertRbacUpdate(apiRequest, rbacResource, knex);
      await assertRowExists(knex, apiRequest.context.tenant, table, idColumn, entityId, label);
    },
    resolveFolder: (knex, tenant, entityId) => firstEntityFolder(knex, tenant, entityType, entityId),
  };
}

const ticketAdapter: EntityAdapter = {
  entityType: 'ticket',
  rbacResource: 'ticket',
  productApiPath: '/api/v1/tickets',
  async assertCanAttach(apiRequest, ticketId, knex) {
    await assertRbacUpdate(apiRequest, 'ticket', knex);
    const ticket = await tenantDb(knex, apiRequest.context.tenant)
      .table('tickets')
      .where({ ticket_id: ticketId })
      .first();
    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }
    const allowed = await authorizeApiResourceRead({
      knex,
      tenant: apiRequest.context.tenant,
      user: apiRequest.context.user,
      apiKeyId: apiRequest.context.apiKeyId,
      resource: 'ticket',
      recordContext: buildTicketRecordContext(ticket as Record<string, any>),
    });
    if (!allowed) {
      throw new ForbiddenError('Permission denied: Cannot read ticket');
    }
  },
  async resolveFolder(knex, tenant, ticketId) {
    const folder = await tenantDb(knex, tenant)
      .table('document_folders')
      .where({ entity_id: ticketId, entity_type: 'ticket', folder_path: '/Tickets/Attachments' })
      .select('folder_path')
      .first();
    return folder?.folder_path ?? undefined;
  },
  documentOverrides: (options) => (options.commentAttachmentDraft ? { is_client_visible: true } : {}),
  async inTransaction({ trx, tenant, actorUserId, entityId, document, options }) {
    if (options.commentAttachmentDraft) {
      await tenantDb(trx, tenant).table('ticket_comment_attachments').insert({
        tenant,
        ticket_id: entityId,
        document_id: document.document_id,
        created_by: actorUserId,
        state: 'draft',
        expires_at: new Date(Date.now() + 86400000),
      });
    }
    // Activity-timeline entry. Written in the same transaction so the timeline row
    // never appears unless the document and its association were also persisted.
    await writeTicketActivity(trx, {
      tenant,
      ticketId: entityId,
      eventType: TICKET_ACTIVITY_EVENT.DOCUMENT_ATTACHED,
      entityType: TICKET_ACTIVITY_ENTITY.DOCUMENT,
      entityId: document.document_id,
      actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: actorUserId },
      source: TICKET_ACTIVITY_SOURCE.API,
      details: {
        document_name: document.document_name,
        mime_type: document.mime_type,
        file_size: document.file_size,
      },
    });
  },
};

const projectTaskAdapter: EntityAdapter = {
  entityType: 'project_task',
  rbacResource: 'project',
  productApiPath: '/api/v1/projects',
  async assertCanAttach(apiRequest, taskId, knex) {
    await assertRbacUpdate(apiRequest, 'project', knex);
    const db = tenantDb(knex, apiRequest.context.tenant);
    const taskQuery = db.table('project_tasks as pt').where({ 'pt.task_id': taskId });
    db.tenantJoin(taskQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
    db.tenantJoin(taskQuery, 'projects as p', 'pp.project_id', 'p.project_id');
    const row = await taskQuery.first<Record<string, any>>('p.*');
    if (!row) {
      throw new NotFoundError('Task not found');
    }
    // The task is readable iff its parent project is (same rule as the project controller).
    const allowed = await authorizeApiResourceRead({
      knex,
      tenant: apiRequest.context.tenant,
      user: apiRequest.context.user,
      apiKeyId: apiRequest.context.apiKeyId,
      resource: 'project',
      recordContext: buildProjectRecordContext(row),
    });
    if (!allowed) {
      throw new ForbiddenError('Permission denied: Cannot read project');
    }
  },
  resolveFolder: (knex, tenant, taskId) => firstEntityFolder(knex, tenant, 'project_task', taskId),
};

export const ENTITY_ADAPTERS: Record<AttachableEntityType, EntityAdapter> = {
  ticket: ticketAdapter,
  project_task: projectTaskAdapter,
  client: simpleAdapter('client', 'client', '/api/v1/clients', 'clients', 'client_id', 'Client'),
  contact: simpleAdapter('contact', 'contact', '/api/v1/contacts', 'contacts', 'contact_name_id', 'Contact'),
  asset: simpleAdapter('asset', 'asset', '/api/v1/assets', 'assets', 'asset_id', 'Asset'),
};

