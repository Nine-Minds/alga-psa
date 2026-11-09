import { isMspPrincipalUserType } from '@alga-psa/types';
import type { Knex } from 'knex';
import type { IDocument, IUser } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/authorization/rbac';
import { createAssetReadContext, filterReadableAssets } from '@alga-psa/authorization/assetReadAuthorization';
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
import { resolveAssociationTargetClientIds } from './documentAssociationTargetAuthorization';

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
  if (isMspPrincipalUserType(user.user_type)) {
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

  const clientIdsByAssociation = await resolveAssociationTargetClientIds(trx, tenant, associations);

  for (const document of documents) {
    const documentAssociations = associationByDocument.get(document.document_id) ?? [];
    const userAssociations = documentAssociations.filter((association) => association.entity_type === 'user');
    const teamAssociations = documentAssociations.filter((association) => association.entity_type === 'team');
    const contactAssociations = documentAssociations.filter((association) => association.entity_type === 'contact');

    const ownerFromUserAssociation = userAssociations[0]?.entity_id ?? null;
    const ownerViaContactMatch =
      user.contact_id && contactAssociations.some((association) => association.entity_id === user.contact_id)
        ? user.user_id
        : null;

    // A document can be linked to multiple clients through its target associations.
    // Resolve target ownership through the shared registry, then prefer the
    // viewer's own clientId when it matches so the kernel's `same_client` rule
    // authorizes the viewer.
    const candidateClientIds = new Set<string>();
    for (const association of documentAssociations) {
      for (const clientId of clientIdsByAssociation.get(`${association.entity_type}:${association.entity_id}`) ?? []) {
        candidateClientIds.add(clientId);
      }
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
  verifiedRecipientLifecycleAccess?: (documentId: string) => Promise<boolean>,
  action: 'read' | 'update' = 'read'
): Promise<T[]> {
  if (documents.length === 0) {
    return [];
  }

  // Document RBAC belongs to callers (see rbacEvaluator below): verified mailbox
  // recipients hold no roles yet are granted access through the lifecycle check.
  // Every associated asset must be readable, regardless of other associations.
  const assetLinks = await tenantScopedTable(trx, 'document_associations', tenant)
    .where({ entity_type: 'asset' }).whereIn('document_id', documents.map(doc => doc.document_id))
    .select<DocumentAssociationRow[]>('document_id', 'entity_id', 'entity_type');
  const readableAssetIds = new Set<string>();
  if (assetLinks.length && await hasPermission({ ...user, tenant }, 'asset', 'read', trx)) {
    const ids = [...new Set(assetLinks.map(link => link.entity_id))];
    const assets = await tenantScopedTable(trx, 'assets', tenant).whereIn('asset_id', ids)
      .select<Array<{ asset_id: string; client_id: string | null }>>('asset_id', 'client_id');
    const context = await createAssetReadContext(trx, tenant, user);
    for (const asset of await filterReadableAssets(trx, tenant, context, assets)) readableAssetIds.add(asset.asset_id);
  }
  const deniedDocuments = new Set(assetLinks.filter(link => !readableAssetIds.has(link.entity_id)).map(link => link.document_id));

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
          action,
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
      const allowed = decision.allowed && !deniedDocuments.has(document.document_id) && !deniedByClientVisibility &&
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

