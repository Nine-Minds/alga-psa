import { beforeAll, describe, expect, it } from 'vitest';

import type { Envelope } from '../../types';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerDefaultNodes } from '../registerDefaultNodes';
import { registerClientActions } from '../../actions/businessOperations/clients';

describe('workflow runtime node smoke for client actions', () => {
  beforeAll(() => {
    const nodeRegistry = getNodeTypeRegistry();
    if (!nodeRegistry.get('action.call')) {
      registerDefaultNodes();
    }

    const actionRegistry = getActionRegistryV2();
    if (!actionRegistry.get('clients.create', 1)) {
      registerClientActions();
    }
  });

  it('T014: action.call can execute clients.create, saveAs output, and use it in a downstream expression', async () => {
    const nodeRegistry = getNodeTypeRegistry();
    const actionRegistry = getActionRegistryV2();

    const actionCallNode = nodeRegistry.get('action.call');
    const assignNode = nodeRegistry.get('transform.assign');
    const clientCreate = actionRegistry.get('clients.create', 1);

    if (!actionCallNode || !assignNode || !clientCreate) {
      throw new Error('Required runtime registrations are missing');
    }

    const originalHandler = clientCreate.handler;

    try {
      clientCreate.handler = async (input: any) => ({
        client: {
          client_id: '00000000-0000-0000-0000-000000000001',
          client_name: input.client_name,
          client_type: 'company',
          url: null,
          billing_email: null,
          is_inactive: false,
          properties: null,
        },
        tags: [],
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
        stepPath: 'steps.client-create',
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
              stepPath: 'steps.client-create',
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
        actionId: 'clients.create',
        version: 1,
        inputMapping: { client_name: 'Workflow Smoke Client' },
        saveAs: 'createdClient',
      });

      env = await actionCallNode.handler(env, actionConfig, nodeCtx as any) as Envelope;

      const assignConfig = assignNode.configSchema.parse({
        assign: {
          'payload.clientNameFromSaveAs': { $expr: 'vars.createdClient.client.client_name' },
          'payload.clientIdFromSaveAs': { $expr: 'vars.createdClient.client.client_id' },
        },
      });

      env = await assignNode.handler(env, assignConfig, {
        ...nodeCtx,
        stepPath: 'steps.assign-output',
      } as any) as Envelope;

      expect((env.payload as any).clientNameFromSaveAs).toBe('Workflow Smoke Client');
      expect((env.payload as any).clientIdFromSaveAs).toBe('00000000-0000-0000-0000-000000000001');
    } finally {
      clientCreate.handler = originalHandler;
    }
  });
});
