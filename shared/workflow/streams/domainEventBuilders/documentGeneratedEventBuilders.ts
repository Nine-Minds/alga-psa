export function buildDocumentGeneratedPayload(params: {
  documentId: string;
  sourceType: string;
  sourceId: string;
  fileName: string;
  generatedByUserId?: string;
  generatedAt?: string;
}): Record<string, unknown> {
  return {
    documentId: params.documentId,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    fileName: params.fileName,
    ...(params.generatedByUserId ? { generatedByUserId: params.generatedByUserId } : {}),
    ...(params.generatedAt ? { generatedAt: params.generatedAt } : {}),
  };
}

