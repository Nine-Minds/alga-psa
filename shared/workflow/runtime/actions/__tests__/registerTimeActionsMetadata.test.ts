import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { buildWorkflowDesignerActionCatalog, type WorkflowDesignerCatalogSourceAction } from '../../designer/actionCatalog';
import { registerTimeActions } from '../businessOperations/time';

const EXPECTED_TIME_ACTION_IDS = [
  'time.create_entry',
  'time.get_entry',
  'time.find_entries',
  'time.update_entry',
  'time.delete_entry',
  'time.set_entry_approval_status',
  'time.request_entry_changes',
  'time.find_or_create_timesheet',
  'time.get_timesheet',
  'time.find_timesheets',
  'time.submit_timesheet',
  'time.approve_timesheet',
  'time.request_timesheet_changes',
  'time.reverse_timesheet_approval',
  'time.add_timesheet_comment',
  'time.summarize_entries',
  'time.find_billing_blockers',
  'time.validate_entries',
] as const;

describe('time workflow action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('time.validate_entries', 1)) {
      registerTimeActions();
    }
  });

  it('T013: all time actions register with stable ids/versions, idempotency metadata, schemas, and Time catalog grouping', () => {
    const registry = getActionRegistryV2();
    const actions = EXPECTED_TIME_ACTION_IDS.map((id) => {
      const action = registry.get(id, 1);
      expect(action, `${id}@1 should be registered`).toBeDefined();
      expect(action?.idempotency.mode).toBe('engineProvided');
      expect(action?.inputSchema).toBeDefined();
      expect(action?.outputSchema).toBeDefined();
      return action!;
    });

    const sourceActions: WorkflowDesignerCatalogSourceAction[] = registry.list().map((action) => ({
      id: action.id,
      version: action.version,
      ui: action.ui,
      inputSchema: zodToWorkflowJsonSchema(action.inputSchema),
      outputSchema: zodToWorkflowJsonSchema(action.outputSchema),
    }));

    const catalog = buildWorkflowDesignerActionCatalog(sourceActions);
    const timeRecord = catalog.find((record) => record.groupKey === 'time');
    expect(timeRecord).toBeDefined();
    expect(timeRecord?.allowedActionIds).toEqual(expect.arrayContaining([...EXPECTED_TIME_ACTION_IDS]));
    expect(timeRecord?.actions.map((action) => action.id)).toEqual(expect.arrayContaining([...EXPECTED_TIME_ACTION_IDS]));
    expect(actions.some((action) => action.sideEffectful)).toBe(true);
  });

  it('T014: time schemas expose user/ticket picker and textarea editor metadata via zod-to-json-schema conversion', () => {
    const registry = getActionRegistryV2();
    const createEntry = registry.get('time.create_entry', 1);
    const findEntries = registry.get('time.find_entries', 1);
    const setApproval = registry.get('time.set_entry_approval_status', 1);

    expect(createEntry).toBeDefined();
    expect(findEntries).toBeDefined();
    expect(setApproval).toBeDefined();

    if (!createEntry || !findEntries || !setApproval) {
      throw new Error('Missing expected time actions for metadata assertions');
    }

    const createSchema = zodToWorkflowJsonSchema(createEntry.inputSchema);
    const findSchema = zodToWorkflowJsonSchema(findEntries.inputSchema);
    const approvalSchema = zodToWorkflowJsonSchema(setApproval.inputSchema);

    const createProps = createSchema.properties as Record<string, Record<string, unknown>>;
    const findProps = findSchema.properties as Record<string, Record<string, unknown>>;
    const approvalProps = approvalSchema.properties as Record<string, Record<string, unknown>>;

    expect(createProps.user_id?.['x-workflow-picker-kind']).toBe('user');
    expect(findProps.ticket_id?.['x-workflow-picker-kind']).toBe('ticket');
    expect(createProps.notes?.['x-workflow-editor']).toMatchObject({
      kind: 'text',
      inline: { mode: 'textarea' },
    });
    expect(approvalProps.change_request_comment?.['x-workflow-editor']).toMatchObject({
      kind: 'text',
      inline: { mode: 'textarea' },
    });
  });
});
