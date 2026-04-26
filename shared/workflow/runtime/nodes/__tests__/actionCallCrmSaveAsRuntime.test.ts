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
    if (!actionRegistry.get('crm.find_quotes', 1)) {
      registerCrmActions();
    }
  });

  it('T013: action.call can execute a follow-up crm action, saveAs output, and use it in a downstream expression', async () => {
    const nodeRegistry = getNodeTypeRegistry();
    const actionRegistry = getActionRegistryV2();

    const actionCallNode = nodeRegistry.get('action.call');
    const assignNode = nodeRegistry.get('transform.assign');
    const findQuotes = actionRegistry.get('crm.find_quotes', 1);

    if (!actionCallNode || !assignNode || !findQuotes) {
      throw new Error('Required runtime registrations are missing');
    }

    const originalHandler = findQuotes.handler;

    try {
      findQuotes.handler = async () => ({
        quotes: [
          {
            activity_id: '00000000-0000-0000-0000-000000000001',
            quote_id: '00000000-0000-0000-0000-000000000001',
            quote_number: 'Q-1001',
            status: 'draft',
            client_id: '00000000-0000-0000-0000-000000000111',
            contact_id: null,
            title: 'Follow-up Quote',
            quote_date: '2026-04-26T12:00:00.000Z',
            valid_until: '2026-05-26T12:00:00.000Z',
            currency_code: 'USD',
            subtotal: 5000,
            discount_total: 0,
            tax: 0,
            total_amount: 5000,
            sent_at: null,
            converted_contract_id: null,
            converted_invoice_id: null,
            is_template: false,
          },
        ],
        first_quote: {
          quote_id: '00000000-0000-0000-0000-000000000001',
          quote_number: 'Q-1001',
          status: 'draft',
          client_id: '00000000-0000-0000-0000-000000000111',
          contact_id: null,
          title: 'Follow-up Quote',
          quote_date: '2026-04-26T12:00:00.000Z',
          valid_until: '2026-05-26T12:00:00.000Z',
          currency_code: 'USD',
          subtotal: 5000,
          discount_total: 0,
          tax: 0,
          total_amount: 5000,
          sent_at: null,
          converted_contract_id: null,
          converted_invoice_id: null,
          is_template: false,
        },
        count: 1,
        pagination: {
          page: 1,
          page_size: 10,
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
        actionId: 'crm.find_quotes',
        version: 1,
        inputMapping: {
          client_id: '00000000-0000-0000-0000-000000000111',
          pageSize: 10,
          on_empty: 'return_empty',
        },
        saveAs: 'crmQuotes',
      });

      env = await actionCallNode.handler(env, actionConfig, nodeCtx as any) as Envelope;

      const assignConfig = assignNode.configSchema.parse({
        assign: {
          'payload.crmQuoteCount': { $expr: 'vars.crmQuotes.count' },
          'payload.crmFirstQuoteTitle': { $expr: 'vars.crmQuotes.quotes[0].title' },
        },
      });

      env = await assignNode.handler(env, assignConfig, {
        ...nodeCtx,
        stepPath: 'steps.assign-output',
      } as any) as Envelope;

      expect((env.payload as any).crmQuoteCount).toBe(1);
      expect((env.payload as any).crmFirstQuoteTitle).toBe('Follow-up Quote');
    } finally {
      findQuotes.handler = originalHandler;
    }
  });
});
