import { describe, expect, it } from 'vitest';
import { DATE_TRIGGER_PAYLOAD_SCHEMA_REFS } from '../dateTriggerPayloadSchemas';

describe('date trigger designer payload schemas', () => {
  it('maps each selectable date source to its payload schema', () => {
    expect(DATE_TRIGGER_PAYLOAD_SCHEMA_REFS).toEqual({
      'client.anniversary': 'payload.ClientAnniversary.v1',
      'contract.renewal_decision': 'payload.ContractRenewalDate.v1',
      'contract.end': 'payload.ContractEndDate.v1',
      'asset.warranty_end': 'payload.AssetWarrantyEnd.v1',
    });
  });
});
