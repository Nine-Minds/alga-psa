export type ExternalMappingChangedPayloadParams = {
  provider: string;
  mappingType: string;
  mappingId: string;
  changedAt?: string;
  previousValue?: unknown;
  newValue?: unknown;
};

export function buildExternalMappingChangedPayload(
  params: ExternalMappingChangedPayloadParams
): Record<string, unknown> {
  return {
    provider: params.provider,
    mappingType: params.mappingType,
    mappingId: params.mappingId,
    ...(params.changedAt ? { changedAt: params.changedAt } : {}),
    ...(params.previousValue !== undefined ? { previousValue: params.previousValue } : {}),
    ...(params.newValue !== undefined ? { newValue: params.newValue } : {}),
  };
}

