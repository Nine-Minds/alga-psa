import { beforeAll, describe, expect, it } from 'vitest';

import type { Envelope } from '../../types';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerDefaultNodes } from '../registerDefaultNodes';
import { registerTransformActionsV2 } from '../../actions/registerTransformActions';

describe('workflow runtime node integration for JSON transform actions', () => {
  beforeAll(() => {
    const nodeRegistry = getNodeTypeRegistry();
    if (!nodeRegistry.get('action.call')) {
      registerDefaultNodes();
    }

    const actionRegistry = getActionRegistryV2();
    if (!actionRegistry.get('transform.parse_json', 1)) {
      registerTransformActionsV2();
    }
  });

  it('action.call can save parse/query outputs and reuse them in downstream expression mappings', async () => {
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
      run: {
        id: 'run-1',
        workflowId: 'workflow-1',
        workflowVersion: 1,
        startedAt: nowIso(),
      },
      payload: {},
      meta: {},
      vars: {
        rawInboundJson: '{"customer":{"email":"ops@example.com"},"assets":[{"tag":"srv-100"},{"tag":"srv-200"}]}',
      },
    };

    const nodeCtx = {
      runId: 'run-1',
      stepPath: 'steps.parse-json',
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
            expressionContext: {
              payload: env.payload,
              vars: env.vars,
              meta: env.meta,
              error: undefined,
            },
          } as any);

          return action.outputSchema.parse(output);
        },
      },
    };

    const parseConfig = actionCallNode.configSchema.parse({
      actionId: 'transform.parse_json',
      version: 1,
      inputMapping: {
        source: { $expr: 'vars.rawInboundJson' },
      },
      saveAs: 'parsedInbound',
    });

    env = await actionCallNode.handler(env, parseConfig, nodeCtx as any) as Envelope;

    const queryConfig = actionCallNode.configSchema.parse({
      actionId: 'transform.query_json',
      version: 1,
      inputMapping: {
        source: { $expr: 'vars.parsedInbound.value' },
        expression: '{"customerEmail": source.customer.email, "assetTags": source.assets.tag}',
      },
      saveAs: 'normalizedInbound',
    });

    env = await actionCallNode.handler(env, queryConfig, {
      ...nodeCtx,
      stepPath: 'steps.query-json',
    } as any) as Envelope;

    const assignConfig = assignNode.configSchema.parse({
      assign: {
        'payload.customerEmail': { $expr: 'vars.normalizedInbound.value.customerEmail' },
        'payload.firstTag': { $expr: 'vars.normalizedInbound.value.assetTags[0]' },
      },
    });

    env = await assignNode.handler(env, assignConfig, {
      ...nodeCtx,
      stepPath: 'steps.assign-output',
    } as any) as Envelope;

    expect((env.vars as any).parsedInbound).toEqual({
      value: {
        customer: { email: 'ops@example.com' },
        assets: [{ tag: 'srv-100' }, { tag: 'srv-200' }],
      },
      type: 'object',
    });
    expect((env.vars as any).normalizedInbound).toEqual({
      value: {
        customerEmail: 'ops@example.com',
        assetTags: ['srv-100', 'srv-200'],
      },
    });
    expect((env.payload as any).customerEmail).toBe('ops@example.com');
    expect((env.payload as any).firstTag).toBe('srv-100');
  });
});
