import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

export function buildDocumentGeneratedPayload(params: {
  documentId: string;
  sourceType: string;
  sourceId: string;
  fileName: string;
  generatedByUserId?: string;
  generatedAt?: string;
}): Record<string, unknown> & BuiltWorkflowPayload<'DOCUMENT_GENERATED'> {
  return builtWorkflowPayload('DOCUMENT_GENERATED', {
    documentId: params.documentId,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    fileName: params.fileName,
    ...(params.generatedByUserId ? { generatedByUserId: params.generatedByUserId } : {}),
    ...(params.generatedAt ? { generatedAt: params.generatedAt } : {}),
  });
}

