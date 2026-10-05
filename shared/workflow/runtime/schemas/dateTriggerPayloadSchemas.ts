import { z } from 'zod';
import { withWorkflowPicker } from '../jsonSchemaMetadata';
import { dateOnlySchema } from './commonEventPayloadSchemas';

const date = dateOnlySchema('Calendar date (YYYY-MM-DD)');
// Entity ids are marked with their kind so the Run dialog and designer offer pickers. The contract
// picker narrows to the payload's client.
const clientId = withWorkflowPicker(z.string(), 'Client', 'client');
const contractId = withWorkflowPicker(z.string(), 'Contract', 'contract', ['clientId']);
const assetId = withWorkflowPicker(z.string(), 'Asset', 'asset');
const common = { occursOn: date, fireDate: date, offsetDays: z.number().int().min(-365).max(365), clientId: clientId.optional(), clientName: z.string().optional() };
export const dateTriggerPayloadSchemas = {
  'payload.ClientAnniversary.v1': z.object({ ...common, clientId, clientName: z.string(), yearsAsClient: z.number().int().positive(), anniversarySource: z.enum(['client_since', 'created_at']) }).passthrough(),
  'payload.ContractRenewalDate.v1': z.object({ ...common, contractId, clientId, renewalMode: z.string().optional(), renewalCycleKey: z.string().optional() }).passthrough(),
  'payload.ContractEndDate.v1': z.object({ ...common, contractId, clientId, endDate: dateOnlySchema('Contract end date (YYYY-MM-DD)') }).passthrough(),
  'payload.AssetWarrantyEnd.v1': z.object({ ...common, assetId, warrantyEndDate: dateOnlySchema('Warranty end date (YYYY-MM-DD)') }).passthrough(),
} as const;

// Date trigger sources: the fixed set of dates a `date` workflow trigger can fire on.
//
// LEVERAGE: pattern date-trigger-source-list — this map is the natural single definition of the
// date sources, but today each source is hand-listed in about seven places. Adding a source means
// editing all of them:
//   - shared/workflow/runtime/types.ts              workflowDateTriggerSchema.source zod enum
//   - this file                                     payload schema + dateTriggerPayloadSchemaRefs entry
//   - ee/packages/workflows/src/lib/dateTriggerSource.ts  DateTriggerSourceId union
//   - packages/jobs/src/lib/dateTriggers/sources/*  the query, which repeats payloadSchemaRef
//   - packages/jobs/src/lib/dateTriggers/registry.ts
//   - ee/server/src/components/workflow-designer/dateTriggerPayloadSchemas.ts  copy of this map
//   - ee/server/src/components/workflow-designer/WorkflowDesigner.tsx  inline copy of this map
//     (triggerSchemaPolicy) and the date source <CustomSelect> options
// Refactor when the next date source is added. Replace this map with a shared
// `dateTriggerSourceDefinitions` list: { id, labelKey, payloadSchemaRef, recurrence, domainEvent? }.
// Derive the zod enum, the source id type, the designer options and the source-to-schema lookup
// from it. packages/jobs then only supplies findOccurrences for each id, and a test checks that every
// definition has a query.
//
// The next source will probably be a custom date field (license expiry, contact birthday, and so on)
// rather than another built-in column. Build that as one source that takes parameters
// ({ source: 'custom_field', entity, fieldId }), not as a new entry per field. That means
// findOccurrences takes `params`, the payload schema can depend on the params, and the fire key
// includes them. Adding an optional `params` to the trigger schema still accepts stored definitions.
export const dateTriggerPayloadSchemaRefs = {
  'client.anniversary': 'payload.ClientAnniversary.v1',
  'contract.renewal_decision': 'payload.ContractRenewalDate.v1',
  'contract.end': 'payload.ContractEndDate.v1',
  'asset.warranty_end': 'payload.AssetWarrantyEnd.v1',
} as const;
