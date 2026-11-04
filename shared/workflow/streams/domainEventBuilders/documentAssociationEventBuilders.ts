import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export function buildDocumentAssociatedPayload(params: {
  documentId: string;
  entityType: string;
  entityId: string;
  associatedByUserId?: string;
  associatedAt?: string | Date;
}): Record<string, unknown> & BuiltWorkflowPayload<'DOCUMENT_ASSOCIATED'> {
  const associatedAt = toIsoString(params.associatedAt);

  return builtWorkflowPayload('DOCUMENT_ASSOCIATED', {
    documentId: params.documentId,
    entityType: params.entityType,
    entityId: params.entityId,
    ...(params.associatedByUserId ? { associatedByUserId: params.associatedByUserId } : {}),
    ...(associatedAt ? { associatedAt } : {}),
  });
}

export function buildDocumentDetachedPayload(params: {
  documentId: string;
  entityType: string;
  entityId: string;
  detachedByUserId?: string;
  detachedAt?: string | Date;
  reason?: string;
}): Record<string, unknown> & BuiltWorkflowPayload<'DOCUMENT_DETACHED'> {
  const detachedAt = toIsoString(params.detachedAt);

  return builtWorkflowPayload('DOCUMENT_DETACHED', {
    documentId: params.documentId,
    entityType: params.entityType,
    entityId: params.entityId,
    ...(params.detachedByUserId ? { detachedByUserId: params.detachedByUserId } : {}),
    ...(detachedAt ? { detachedAt } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  });
}

