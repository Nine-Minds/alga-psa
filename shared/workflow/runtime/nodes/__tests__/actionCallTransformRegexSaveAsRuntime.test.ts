import { beforeAll, describe, expect, it } from 'vitest';

import type { Envelope } from '../../types';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerDefaultNodes } from '../registerDefaultNodes';
import { registerTransformActionsV2 } from '../../actions/registerTransformActions';

describe('workflow runtime node integration for regex transform actions', () => {
  beforeAll(() => {
    const nodeRegistry = getNodeTypeRegistry();
    if (!nodeRegistry.get('action.call')) {
      registerDefaultNodes();
    }

    const actionRegistry = getActionRegistryV2();
    if (!actionRegistry.get('transform.regex_extract', 1)) {
      registerTransformActionsV2();
    }
  });

  it('action.call can save regex_extract output and downstream steps can reference captures', async () => {
    const nodeRegistry = getNodeTypeRegistry();
    const actionRegistry = getActionRegistryV2();
    const actionCallNode = nodeRegistry.get('action.call');
    const assignNode = nodeRegistry.get('transform.assign');
    if (!actionCallNode || !assignNode) {
      throw new Error('Required runtime registrations are missing');
    }

    const nowIso = () => new Date().toISOString();
    let env: Envelope = {
      v: 1,
      run: { id: 'run-1', workflowId: 'wf-1', workflowVersion: 1, startedAt: nowIso() },
      payload: {},
      meta: {},
      vars: { bodyText: 'Alert for host srv-nyc-01 serial SN-778899' },
    };

    const nodeCtx = {
      runId: 'run-1',
      stepPath: 'steps.regex-extract',
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
            stepPath: 'steps.transform',
            idempotencyKey: 'idem-1',
            attempt: 1,
            nowIso,
            env,
            tenantId: 'tenant-1',
            expressionContext: { payload: env.payload, vars: env.vars, meta: env.meta, error: undefined },
          } as any);
          return action.outputSchema.parse(output);
        },
      },
    };

    const extractConfig = actionCallNode.configSchema.parse({
      actionId: 'transform.regex_extract',
      version: 1,
      inputMapping: {
        text: { $expr: 'vars.bodyText' },
        pattern: 'host\\s+(?<host>[a-z0-9-]+)\\s+serial\\s+(?<serial>SN-\\d+)',
      },
      saveAs: 'parsedAlert',
    });
    env = await actionCallNode.handler(env, extractConfig, nodeCtx as any) as Envelope;

    const assignConfig = assignNode.configSchema.parse({
      assign: {
        'payload.host': { $expr: 'vars.parsedAlert.first.namedGroups.host' },
        'payload.serial': { $expr: 'vars.parsedAlert.first.namedGroups.serial' },
      },
    });
    env = await assignNode.handler(env, assignConfig, { ...nodeCtx, stepPath: 'steps.assign' } as any) as Envelope;

    expect((env.vars as any).parsedAlert.count).toBe(1);
    expect((env.vars as any).parsedAlert.first).toEqual({
      text: 'host srv-nyc-01 serial SN-778899',
      index: 10,
      groups: ['srv-nyc-01', 'SN-778899'],
      namedGroups: {
        host: 'srv-nyc-01',
        serial: 'SN-778899',
      },
    });
    expect((env.payload as any).host).toBe('srv-nyc-01');
    expect((env.payload as any).serial).toBe('SN-778899');
  });
});
