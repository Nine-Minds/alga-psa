import { beforeAll, describe, expect, it } from 'vitest';

import type { Envelope } from '../../types';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerDefaultNodes } from '../registerDefaultNodes';
import { registerSchedulingActions } from '../../actions/businessOperations/scheduling';

describe('workflow runtime node smoke for scheduling actions', () => {
  beforeAll(() => {
    const nodeRegistry = getNodeTypeRegistry();
    if (!nodeRegistry.get('action.call')) {
      registerDefaultNodes();
    }

    const actionRegistry = getActionRegistryV2();
    if (!actionRegistry.get('scheduling.find_entry', 1)) {
      registerSchedulingActions();
    }
  });

  it('T016: action.call can execute scheduling.find_entry, saveAs output, and use it in a downstream expression', async () => {
    const nodeRegistry = getNodeTypeRegistry();
    const actionRegistry = getActionRegistryV2();

    const actionCallNode = nodeRegistry.get('action.call');
    const assignNode = nodeRegistry.get('transform.assign');
    const schedulingFind = actionRegistry.get('scheduling.find_entry', 1);

    if (!actionCallNode || !assignNode || !schedulingFind) {
      throw new Error('Required runtime registrations are missing');
    }

    const originalHandler = schedulingFind.handler;

    try {
      schedulingFind.handler = async () => ({
        found: true,
        entry: {
          entry_id: '00000000-0000-0000-0000-000000000111',
          original_entry_id: null,
          title: 'Workflow Smoke Entry',
          notes: null,
          status: 'scheduled',
          scheduled_start: '2026-05-01T10:00:00.000Z',
          scheduled_end: '2026-05-01T11:00:00.000Z',
          work_item_id: '00000000-0000-0000-0000-000000000222',
          work_item_type: 'ticket',
          is_private: false,
          is_recurring: false,
          assigned_user_ids: [],
        },
      });

      const nowIso = () => new Date().toISOString();

      let env: Envelope = {
        v: 1,
        run: {
          id: 'run-1',
          workflowId: 'workflow-1',
          workflowVersion: 1,
          startedAt: nowIso(),
        },
        payload: {},
        meta: {},
        vars: {},
      };

      const nodeCtx = {
        runId: 'run-1',
        stepPath: 'steps.scheduling-find',
        tenantId: 'tenant-1',
        nowIso,
        publishWait: async () => {},
        actions: {
          call: async (actionId: string, version: number, args: unknown) => {
            const action = actionRegistry.get(actionId, version);
            if (!action) throw new Error(`Unknown action ${actionId}@${version}`);

            const parsedInput = action.inputSchema.parse(args);
            const output = await action.handler(parsedInput, {
              runId: 'run-1',
              stepPath: 'steps.scheduling-find',
              idempotencyKey: 'idem-1',
              attempt: 1,
              nowIso,
              env,
              tenantId: 'tenant-1',
            } as any);

            return action.outputSchema.parse(output);
          },
        },
      };

      const actionConfig = actionCallNode.configSchema.parse({
        actionId: 'scheduling.find_entry',
        version: 1,
        inputMapping: { entry_id: '00000000-0000-0000-0000-000000000111' },
        saveAs: 'foundEntry',
      });

      env = await actionCallNode.handler(env, actionConfig, nodeCtx as any) as Envelope;

      const assignConfig = assignNode.configSchema.parse({
        assign: {
          'payload.entryFound': { $expr: 'vars.foundEntry.found' },
          'payload.entryTitle': { $expr: 'vars.foundEntry.entry.title' },
        },
      });

      env = await assignNode.handler(env, assignConfig, {
        ...nodeCtx,
        stepPath: 'steps.assign-output',
      } as any) as Envelope;

      expect((env.payload as any).entryFound).toBe(true);
      expect((env.payload as any).entryTitle).toBe('Workflow Smoke Entry');
    } finally {
      schedulingFind.handler = originalHandler;
    }
  });
});
