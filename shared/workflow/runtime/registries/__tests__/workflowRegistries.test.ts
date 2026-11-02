import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerWorkflowTicketMutationAdapter,
  resetWorkflowTicketMutationAdapter,
  withWorkflowTicketMutation,
} from '../workflowTicketMutationRegistry';
import {
  getWorkflowConversationRetainer,
  registerWorkflowConversationRetainer,
  resetWorkflowConversationRetainer,
} from '../workflowConversationRegistry';

const input = { tenant: 't', ticketId: 'k', workflowRunId: 'r', actorUserId: 'u', fields: ['a'], readFields: [] };

function countingTrx() {
  const queries: string[] = [];
  const trx: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'isTransaction') return true;
      queries.push(String(prop));
      return undefined;
    },
  });
  return { trx, queries };
}

afterEach(() => {
  resetWorkflowTicketMutationAdapter();
  resetWorkflowConversationRetainer();
});

describe('workflow registries defaults', () => {
  it('mutation adapter absent: runs write({}) with zero queries', async () => {
    const { trx, queries } = countingTrx();
    const write = vi.fn(async (effects: object) => effects);
    await expect(withWorkflowTicketMutation(trx, input, write)).resolves.toEqual({});
    expect(write).toHaveBeenCalledTimes(1);
    expect(queries).toEqual([]);
  });

  it('requires a transaction', async () => {
    await expect(withWorkflowTicketMutation({ isTransaction: false } as any, input, async () => 1)).rejects.toThrow();
  });

  it('a registered adapter wraps the write with a copy of the input', async () => {
    const { trx } = countingTrx();
    const adapter = vi.fn(async (_t: any, i: any, write: any) => write({ marker: i.fields }));
    registerWorkflowTicketMutationAdapter(adapter as any);
    await withWorkflowTicketMutation(trx, input, async (e) => e);
    expect(adapter.mock.calls[0][1].fields).toEqual(['a']);
    expect(adapter.mock.calls[0][1].fields).not.toBe(input.fields);
  });

  it('conversation retainer absent: undefined', () => {
    expect(getWorkflowConversationRetainer()).toBeUndefined();
    const retainer = vi.fn(async () => true);
    registerWorkflowConversationRetainer(retainer);
    expect(getWorkflowConversationRetainer()).toBe(retainer);
    resetWorkflowConversationRetainer();
    expect(getWorkflowConversationRetainer()).toBeUndefined();
  });
});
