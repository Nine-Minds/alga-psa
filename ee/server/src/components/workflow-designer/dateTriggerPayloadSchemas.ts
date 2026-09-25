// LEVERAGE: pattern date-trigger-source-list — duplicates dateTriggerPayloadSchemaRefs in
// shared/workflow/runtime/schemas/dateTriggerPayloadSchemas.ts; import that instead.
export const DATE_TRIGGER_PAYLOAD_SCHEMA_REFS = {
  'client.anniversary': 'payload.ClientAnniversary.v1',
  'contract.renewal_decision': 'payload.ContractRenewalDate.v1',
  'contract.end': 'payload.ContractEndDate.v1',
  'asset.warranty_end': 'payload.AssetWarrantyEnd.v1',
} as const;
