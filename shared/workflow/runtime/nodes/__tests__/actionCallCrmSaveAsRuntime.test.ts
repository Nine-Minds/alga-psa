import { beforeAll, describe, expect, it } from 'vitest';

import type { Envelope } from '../../types';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerDefaultNodes } from '../registerDefaultNodes';
import { registerCrmActions } from '../../actions/businessOperations/crm';

describe('workflow runtime node smoke for crm actions', () => {
  beforeAll(() => {
    const nodeRegistry = getNodeTypeRegistry();
    if (!nodeRegistry.get('action.call')) {
      registerDefaultNodes();
    }

    const actionRegistry = getActionRegistryV2();
    if (!actionRegistry.get('crm.find_activities', 1)) {
      registerCrmActions();
    }
  });

  it('T013: action.call can execute crm.find_activities, saveAs output, and use it in a downstream expression', async () => {
    const nodeRegistry = getNodeTypeRegistry();
    const actionRegistry = getActionRegistryV2();

    const actionCallNode = nodeRegistry.get('action.call');
    const assignNode = nodeRegistry.get('transform.assign');
    const findActivities = actionRegistry.get('crm.find_activities', 1);

    if (!actionCallNode || !assignNode || !findActivities) {
      throw new Error('Required runtime registrations are missing');
    }

    const originalHandler = findActivities.handler;

    try {
      findActivities.handler = async () => ({
        activities: [
          {
            activity_id: '00000000-0000-0000-0000-000000000001',
            type_id: '00000000-0000-0000-0000-000000000011',
            type_name: 'Call',
            status_id: null,
            status_name: null,
            client_id: '00000000-0000-0000-0000-000000000111',
            client_name: 'Acme Corp',
            contact_id: null,
            contact_name: null,
            ticket_id: null,
            ticket_number: null,
            title: 'Follow-up',
            notes_preview: null,
            interaction_date: '2026-04-26T12:00:00.000Z',
            start_time: '2026-04-26T12:00:00.000Z',
            end_time: '2026-04-26T12:30:00.000Z',
            duration: 30,
            user_id: '00000000-0000-0000-0000-000000000021',
            user_name: 'Workflow Actor',
            visibility: 'internal',
            category: 'follow-up',
            tags: ['qbr'],
          },
        ],
        count: 1,
        matched_filters: {
          client_id: '00000000-0000-0000-0000-000000000111',
          limit: 10,
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
        stepPath: 'steps.crm-find',
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
              stepPath: 'steps.crm-find',
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
        actionId: 'crm.find_activities',
        version: 1,
        inputMapping: {
          client_id: '00000000-0000-0000-0000-000000000111',
          limit: 10,
          on_empty: 'return_empty',
        },
        saveAs: 'crmActivities',
      });

      env = await actionCallNode.handler(env, actionConfig, nodeCtx as any) as Envelope;

      const assignConfig = assignNode.configSchema.parse({
        assign: {
          'payload.crmActivityCount': { $expr: 'vars.crmActivities.count' },
          'payload.crmFirstTitle': { $expr: 'vars.crmActivities.activities[0].title' },
        },
      });

      env = await assignNode.handler(env, assignConfig, {
        ...nodeCtx,
        stepPath: 'steps.assign-output',
      } as any) as Envelope;

      expect((env.payload as any).crmActivityCount).toBe(1);
      expect((env.payload as any).crmFirstTitle).toBe('Follow-up');
    } finally {
      findActivities.handler = originalHandler;
    }
  });
});
