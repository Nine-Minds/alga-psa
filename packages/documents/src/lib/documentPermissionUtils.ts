// @ts-nocheck
// TODO: DocumentAssociation model method signature changes
import type { IUser, IDocument, IDocumentAssociation } from '@alga-psa/types';
import { hasPermissionAsync } from './authHelpers';
import DocumentAssociation from '@alga-psa/documents/models/documentAssociation';
import { createTenantKnex } from '@alga-psa/db';

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
 * Check if a user can access a specific document based on:
 * 1. User has 'document' read permission
 * 2. User has permission for at least one entity the document is associated with
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
  if (!(await hasPermissionAsync(user, 'document', 'read'))) {
    return false;
  }

  // 2. Get all associations for this document
  const associations = await DocumentAssociation.getByDocumentId(
    document.document_id
  );

  // 3. If no associations, allow access (tenant-level document)
  if (!associations || associations.length === 0) {
    return true;
  }

  // 4. Check if user has permission for ANY associated entity
  for (const assoc of associations) {
    const requiredPermission = ENTITY_TO_PERMISSION_MAP[assoc.entity_type];

    // Special case: tenant-level documents are accessible
    if (assoc.entity_type === 'tenant') {
      return true;
    }

    // Check if user has the required permission for this entity type
    if (requiredPermission && (await hasPermissionAsync(user, requiredPermission, 'read'))) {
      return true;
    }
  }

  // 5. User doesn't have permission for any associated entity
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
  if (!(await hasPermissionAsync(user, 'document', 'read'))) {
    return [];
  }

  // 2. Build list of permissions user has for entity types
  const userEntityPermissions = new Set<string>();
  for (const [entityType, permission] of Object.entries(ENTITY_TO_PERMISSION_MAP)) {
    if (await hasPermissionAsync(user, permission, 'read')) {
      userEntityPermissions.add(entityType);
    }
  }

  // 3. Bulk load associations for all documents (single query!)
  const documentIds = documents.map(d => d.document_id);
  const { knex } = await createTenantKnex();

  const associations = await knex('document_associations')
    .whereIn('document_id', documentIds)
    .andWhere('tenant', documents[0].tenant)
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
  if (!(await hasPermissionAsync(user, 'document', 'update'))) {
    return false;
  }

  // Need permission for the target entity type
  const requiredPermission = ENTITY_TO_PERMISSION_MAP[entityType];
  if (!requiredPermission) {
    return false;
  }

  return await hasPermissionAsync(user, requiredPermission, 'read');
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
    if (await hasPermissionAsync(user, permission, 'read')) {
      allowedTypes.push(entityType);
    }
  }

  return allowedTypes;
}
