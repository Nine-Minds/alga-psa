import { describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { dateTriggerPayloadSchemas } from '../dateTriggerPayloadSchemas';
import { contractCreatedEventPayloadSchema } from '../billingEventSchemas';
import { workflowEventPayloadSchemas } from '../workflowEventPayloadSchemas';

const propertiesOf = (schema: Record<string, unknown>) =>
  (schema.properties ?? {}) as Record<string, Record<string, unknown>>;

describe('entity id metadata on trigger payloads', () => {
  it('marks the contract-ending date trigger ids and dates for the Run dialog', () => {
    const properties = propertiesOf(zodToWorkflowJsonSchema(dateTriggerPayloadSchemas['payload.ContractEndDate.v1']));
    expect(properties.contractId).toMatchObject({
      'x-workflow-picker-kind': 'contract',
      'x-workflow-picker-dependencies': ['clientId'],
      'x-workflow-picker-fixed-value-hint': 'Search contracts',
    });
    expect(properties.clientId).toMatchObject({ 'x-workflow-picker-kind': 'client' });
    expect(properties.endDate.pattern).toBe(properties.occursOn.pattern);
  });

  it('accepts real date-trigger payloads and rejects malformed dates', () => {
    const schema = dateTriggerPayloadSchemas['payload.ContractEndDate.v1'];
    const payload = {
      occursOn: '2026-12-31',
      fireDate: '2026-12-01',
      offsetDays: -30,
      contractId: 'contract-1',
      clientId: 'client-1',
      clientName: 'Acme',
      endDate: '2026-12-31',
    };
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, endDate: '12/31/2026' }).success).toBe(false);
  });

  it('marks contract ids on billing events', () => {
    const properties = propertiesOf(zodToWorkflowJsonSchema(contractCreatedEventPayloadSchema));
    expect(properties.contractId).toMatchObject({ 'x-workflow-picker-kind': 'contract' });
    expect(properties.clientId).toMatchObject({ 'x-workflow-picker-kind': 'client' });
  });

  it('leaves no client, contact, user, ticket, project, or contract id on any event payload without a picker kind', () => {
    const ENTITY_ID_KEYS = /^(client|contact|user|ticket|project|contract)Id$/;
    const missing: string[] = [];
    for (const [ref, schema] of Object.entries(workflowEventPayloadSchemas)) {
      const properties = propertiesOf(zodToWorkflowJsonSchema(schema as never));
      for (const [key, property] of Object.entries(properties)) {
        if (ENTITY_ID_KEYS.test(key) && !property['x-workflow-picker-kind']) missing.push(`${ref}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
