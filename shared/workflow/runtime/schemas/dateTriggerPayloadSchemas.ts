import { z } from 'zod';

const date = z.string().date();
const common = { occursOn: date, fireDate: date, offsetDays: z.number().int().min(-365).max(365), clientId: z.string().optional(), clientName: z.string().optional() };
export const dateTriggerPayloadSchemas = {
  'payload.ClientAnniversary.v1': z.object({ ...common, clientId: z.string(), clientName: z.string(), yearsAsClient: z.number().int().positive(), anniversarySource: z.enum(['client_since', 'created_at']) }).passthrough(),
  'payload.ContractRenewalDate.v1': z.object({ ...common, contractId: z.string(), clientId: z.string(), renewalMode: z.string().optional(), renewalCycleKey: z.string().optional() }).passthrough(),
  'payload.ContractEndDate.v1': z.object({ ...common, contractId: z.string(), clientId: z.string(), endDate: z.string() }).passthrough(),
  'payload.AssetWarrantyEnd.v1': z.object({ ...common, assetId: z.string(), warrantyEndDate: z.string() }).passthrough(),
} as const;

export const dateTriggerPayloadSchemaRefs = {
  'client.anniversary': 'payload.ClientAnniversary.v1',
  'contract.renewal_decision': 'payload.ContractRenewalDate.v1',
  'contract.end': 'payload.ContractEndDate.v1',
  'asset.warranty_end': 'payload.AssetWarrantyEnd.v1',
} as const;
