import { describe, expect, it } from 'vitest';
import { workflowDefinitionSchema } from '@shared/workflow/runtime';
import { TEST_SCHEMA_REF } from '../helpers/workflowRuntimeV2TestHelpers';
import {
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput
} from '../../../../packages/workflows/src/actions/workflow-runtime-v2-schemas';

describe('Workflow time trigger schemas', () => {
  it('T001: workflow definition accepts a one-time schedule trigger variant', () => {
    const parsed = workflowDefinitionSchema.safeParse({
      id: 'workflow-schedule',
      version: 1,
      name: 'One-time workflow',
      payloadSchemaRef: TEST_SCHEMA_REF,
      trigger: {
        type: 'schedule',
        runAt: '2026-03-08T14:00:00.000Z'
      },
      steps: []
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.trigger).toEqual({
      type: 'schedule',
      runAt: '2026-03-08T14:00:00.000Z'
    });
  });

  it('T002: workflow definition accepts a recurring schedule trigger variant', () => {
    const parsed = workflowDefinitionSchema.safeParse({
      id: 'workflow-recurring',
      version: 2,
      name: 'Recurring workflow',
      payloadSchemaRef: TEST_SCHEMA_REF,
      trigger: {
        type: 'recurring',
        cron: '15 9 * * 1-5',
        timezone: 'America/New_York'
      },
      steps: []
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.trigger).toEqual({
      type: 'recurring',
      cron: '15 9 * * 1-5',
      timezone: 'America/New_York'
    });
  });

  it('T003: workflow definition without a trigger remains valid and is not coerced into an explicit manual trigger type', () => {
    const parsed = workflowDefinitionSchema.safeParse({
      id: 'workflow-manual',
      version: 1,
      name: 'Manual workflow',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: []
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.prototype.hasOwnProperty.call(parsed.data, 'trigger')).toBe(false);
  });

  it('T004: create workflow input accepts one-time schedule trigger payloads', () => {
    const parsed = CreateWorkflowDefinitionInput.safeParse({
      definition: {
        id: 'workflow-create-schedule',
        version: 1,
        name: 'Create schedule workflow',
        payloadSchemaRef: TEST_SCHEMA_REF,
        trigger: {
          type: 'schedule',
          runAt: '2026-03-08T15:30:00.000Z'
        },
        steps: []
      }
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.definition.trigger).toEqual({
      type: 'schedule',
      runAt: '2026-03-08T15:30:00.000Z'
    });
  });

  it('T005: update workflow input accepts recurring schedule trigger payloads', () => {
    const parsed = UpdateWorkflowDefinitionInput.safeParse({
      workflowId: 'workflow-update-recurring',
      definition: {
        id: 'workflow-update-recurring',
        version: 3,
        name: 'Update recurring workflow',
        payloadSchemaRef: TEST_SCHEMA_REF,
        trigger: {
          type: 'recurring',
          cron: '0 6 * * *',
          timezone: 'UTC'
        },
        steps: []
      }
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.definition.trigger).toEqual({
      type: 'recurring',
      cron: '0 6 * * *',
      timezone: 'UTC'
    });
  });
});
