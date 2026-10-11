import { describe, expect, it } from 'vitest';
import { dateTriggerSourceDefinitions } from '@alga-psa/workflows/authoring';
import { DATE_TRIGGER_PAYLOAD_SCHEMA_REFS } from '../dateTriggerPayloadSchemas';

describe('date trigger designer payload schemas', () => {
  it('maps each selectable date source to its payload schema', () => {
    expect(DATE_TRIGGER_PAYLOAD_SCHEMA_REFS).toEqual({
      'client.anniversary': 'payload.ClientAnniversary.v1',
      'contract.renewal_decision': 'payload.ContractRenewalDate.v1',
      'contract.end': 'payload.ContractEndDate.v1',
      'asset.warranty_end': 'payload.AssetWarrantyEnd.v1',
      'ticket.status_age': 'payload.TicketStatusAge.v1',
    });
  });

  it('is derived from the shared source definitions, so the picker and the map cannot drift', () => {
    expect(Object.keys(DATE_TRIGGER_PAYLOAD_SCHEMA_REFS).sort()).toEqual(dateTriggerSourceDefinitions.map((d) => d.id).sort());
    for (const definition of dateTriggerSourceDefinitions) {
      expect((DATE_TRIGGER_PAYLOAD_SCHEMA_REFS as Record<string, string>)[definition.id]).toBe(definition.payloadSchemaRef);
    }
  });
});
