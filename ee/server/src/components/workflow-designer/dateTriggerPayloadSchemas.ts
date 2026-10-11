// The source-to-payload-schema map is derived from the shared source definitions
// (shared/workflow/runtime/dateTriggerSourceDefinitions.ts); there is no separate copy here.
import { dateTriggerSourceDefinitions, type DateTriggerPayloadSchemaRefs } from '@alga-psa/workflows/authoring';

export const DATE_TRIGGER_PAYLOAD_SCHEMA_REFS = Object.fromEntries(
  dateTriggerSourceDefinitions.map((definition) => [definition.id, definition.payloadSchemaRef]),
) as DateTriggerPayloadSchemaRefs;
