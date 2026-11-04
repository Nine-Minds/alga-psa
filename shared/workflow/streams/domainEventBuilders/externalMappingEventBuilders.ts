import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

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
): Record<string, unknown> & BuiltWorkflowPayload<'EXTERNAL_MAPPING_CHANGED'> {
  return builtWorkflowPayload('EXTERNAL_MAPPING_CHANGED', {
    provider: params.provider,
    mappingType: params.mappingType,
    mappingId: params.mappingId,
    ...(params.changedAt ? { changedAt: params.changedAt } : {}),
    ...(params.previousValue !== undefined ? { previousValue: params.previousValue } : {}),
    ...(params.newValue !== undefined ? { newValue: params.newValue } : {}),
  });
}

