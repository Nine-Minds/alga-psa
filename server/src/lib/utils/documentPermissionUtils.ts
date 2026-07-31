import { IUser } from '@/interfaces/auth.interfaces';
import { IDocument } from '@/interfaces/document.interface';
import { IDocumentAssociation } from '@/interfaces/document-association.interface';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/lib/db';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { authorizeAndRedactDocuments } from '@alga-psa/documents/actions/documentActions';
import { Knex } from 'knex';

/**
 * Entity type to required resource permission mapping
 */
const ENTITY_TO_PERMISSION_MAP: Record<string, string> = {
  'contract': 'billing',
  'ticket': 'ticket',
  'client': 'client',
  'contact': 'contact',
  'asset': 'asset',
  'project_task': 'project_task',
  'user': 'user',
  'tenant': 'tenant', // Special case - always accessible
};

/**
 * Check whether a client-portal contact can access a document using the
 * canonical client-portal visibility model (the same authorization path as
 * downloadDocument / getAuthorizedDocumentByFileId): the contact must own the
 * document or the document must be associated with their client and flagged
 * is_client_visible.
 */
async function canClientAccessDocument(
  user: IUser,
  document: IDocument,
  db: Knex,
  tenant: string
): Promise<boolean> {
  // authorizeAndRedactDocuments resolves same-client visibility from
  // user.clientId, which session-resolved users may not have populated;
  // derive it from the contact record the way getUserWithRoles does.
  let clientId = (user as IUser & { clientId?: string }).clientId;
  if (!clientId && user.contact_id) {
    const contact = await tenantDb(db, tenant).table('contacts')
      .select('client_id')
      .where({ contact_name_id: user.contact_id })
      .first();
    clientId = contact?.client_id ?? undefined;
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [authorizedDocument] = await authorizeAndRedactDocuments(
      trx,
      tenant,
      { ...user, clientId },
      [document]
    );
    return Boolean(authorizedDocument);
  });
}

/**
 * Check if a user can access a specific document based on:
 * 1. User has 'document' read permission
 * 2. Client-portal contacts: document satisfies the client-portal visibility
 *    model (owned by the contact, or associated with their client and
 *    is_client_visible)
 * 3. Internal users: permission for at least one entity the document is
 *    associated with
 *
 * @param user - Current user
 * @param document - Document to check access for
 * @returns Promise<boolean> - true if user can access the document
 */
export async function canAccessDocument(
  user: IUser,
  document: IDocument
): Promise<boolean> {
  // 1. Check if user has 'document' read permission
  if (!(await hasPermission(user, 'document', 'read'))) {
    return false;
  }

  const { knex: db, tenant } = await createTenantKnex();
  const effectiveTenant = tenant ?? document.tenant;
  if (!effectiveTenant) {
    throw new Error('Tenant context not found');
  }

  // 2. Client-portal contacts must satisfy the client-portal visibility
  // model; the entity-type permission checks below are for internal (MSP)
  // users only and would otherwise grant contacts access to any document
  // whose associations match an entity type they can read.
  if (user.user_type === 'client') {
    return canClientAccessDocument(user, document, db, effectiveTenant);
  }

  // 3. Get all associations for this document
  const associations: IDocumentAssociation[] = await tenantDb(db, effectiveTenant).table<IDocumentAssociation>('document_associations')
    .select('*')
    .where({ document_id: document.document_id });

  // 4. If no associations, allow access (tenant-level document)
  if (!associations || associations.length === 0) {
    return true;
  }

  // 5. Check if user has permission for ANY associated entity
  for (const assoc of associations) {
    const requiredPermission = ENTITY_TO_PERMISSION_MAP[assoc.entity_type];

    // Special case: tenant-level documents are accessible
    if (assoc.entity_type === 'tenant') {
      return true;
    }

    // Check if user has the required permission for this entity type
    if (requiredPermission && (await hasPermission(user, requiredPermission, 'read'))) {
      return true;
    }
  }

  // 6. User doesn't have permission for any associated entity
  return false;
}

/**
 * Filter a list of documents based on user permissions (OPTIMIZED - avoids N+1)
 *
 * @param user - Current user
 * @param documents - Array of documents to filter
 * @returns Promise<IDocument[]> - Filtered array of accessible documents
 */
export async function filterAccessibleDocuments(
  user: IUser,
  documents: IDocument[]
): Promise<IDocument[]> {
  if (documents.length === 0) return [];

  // 1. Check if user has 'document' read permission
  if (!(await hasPermission(user, 'document', 'read'))) {
    return [];
  }

  // 2. Build list of permissions user has for entity types
  const userEntityPermissions = new Set<string>();
  for (const [entityType, permission] of Object.entries(ENTITY_TO_PERMISSION_MAP)) {
    if (await hasPermission(user, permission, 'read')) {
      userEntityPermissions.add(entityType);
    }
  }

  // 3. Bulk load associations for all documents (single query!)
  const documentIds = documents.map(d => d.document_id);
  const { knex } = await createTenantKnex();
  const tenant = documents[0].tenant;
  if (!tenant) {
    throw new Error('Tenant context not found');
  }

  const associations = await tenantDb(knex, tenant).table('document_associations')
    .whereIn('document_id', documentIds)
    .select('document_id', 'entity_type');

  // 4. Build map of document_id -> entity_types
  const docAssociationsMap = new Map<string, Set<string>>();
  for (const assoc of associations) {
    if (!docAssociationsMap.has(assoc.document_id)) {
      docAssociationsMap.set(assoc.document_id, new Set());
    }
    docAssociationsMap.get(assoc.document_id)!.add(assoc.entity_type);
  }

  // 5. Filter documents based on associations and permissions
  const accessibleDocuments: IDocument[] = [];
  for (const doc of documents) {
    const docEntityTypes = docAssociationsMap.get(doc.document_id);

    // No associations = tenant-level document = accessible
    if (!docEntityTypes || docEntityTypes.size === 0) {
      accessibleDocuments.push(doc);
      continue;
    }

    // Check if user has permission for ANY entity type this document is associated with
    let hasAccess = false;
    for (const entityType of docEntityTypes) {
      if (entityType === 'tenant' || userEntityPermissions.has(entityType)) {
        hasAccess = true;
        break;
      }
    }

    if (hasAccess) {
      accessibleDocuments.push(doc);
    }
  }

  return accessibleDocuments;
}

/**
 * Check if user can associate a document with a specific entity
 * User needs both 'document' permission and permission for the entity
 *
 * @param user - Current user
 * @param entityType - Type of entity to associate with
 * @returns Promise<boolean> - true if user can create the association
 */
export async function canAssociateWithEntity(
  user: IUser,
  entityType: string
): Promise<boolean> {
  // Need document permission
  if (!(await hasPermission(user, 'document', 'update'))) {
    return false;
  }

  // Need permission for the target entity type
  const requiredPermission = ENTITY_TO_PERMISSION_MAP[entityType];
  if (!requiredPermission) {
    return false;
  }

  return await hasPermission(user, requiredPermission, 'read');
}

/**
 * Get list of entity types user has permission to access
 * (Used for database-level filtering in queries)
 *
 * @param user - Current user
 * @returns Promise<string[]> - Array of entity types user can access
 */
export async function getEntityTypesForUser(user: IUser): Promise<string[]> {
  const allowedTypes: string[] = ['tenant']; // Always include tenant

  for (const [entityType, permission] of Object.entries(ENTITY_TO_PERMISSION_MAP)) {
    if (await hasPermission(user, permission, 'read')) {
      allowedTypes.push(entityType);
    }
  }

  return allowedTypes;
}
