import { describe, expect, it } from 'vitest';

import type { SmartSearchEvent } from '@alga-psa/tickets/lib/smartTicketSearch/types';

import {
  applySmartSearchEvent,
  parseSseFrames,
  type SmartSearchState,
} from '../../components/tickets/smartSearch/useSmartTicketSearchStream';

const initial: SmartSearchState = {
  status: 'idle',
  total: 0,
  scored: 0,
  failed: 0,
  buckets: { strong: [], possible: [], unlikely: [] },
  unscoredTicketIds: [],
  error: null,
  inputTokens: null,
};

const ticket = (id: string) => ({ ticket_id: id, title: id }) as never;
const metadata = { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} };

describe('parseSseFrames', () => {
  it('splits complete frames, keeps the partial tail, and ignores keepalive comments', () => {
    const input = 'event: started\ndata: {"a":1}\n\n: keepalive\n\ndata: [DONE]\n\nevent: scored\ndata: {"partial';
    const { frames, rest } = parseSseFrames(input);
    expect(frames).toEqual([
      { event: 'started', data: '{"a":1}' },
      { event: 'message', data: '[DONE]' },
    ]);
    expect(rest).toBe('event: scored\ndata: {"partial');
  });

  it('joins multi-line data', () => {
    const { frames } = parseSseFrames('data: one\ndata: two\n\n');
    expect(frames).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });
});

describe('applySmartSearchEvent', () => {
  it('appends scored items to their bucket in arrival order and never reorders', () => {
    let state = applySmartSearchEvent(initial, { type: 'started', searchId: 's', total: 4 });
    expect(state.status).toBe('running');

    const first: SmartSearchEvent = {
      type: 'scored',
      scored: 2,
      metadata,
      items: [
        { ticket: ticket('a'), score: 0.9, bucket: 'strong' },
        { ticket: ticket('b'), score: 0.1, bucket: 'unlikely' },
      ],
    };
    const second: SmartSearchEvent = {
      type: 'scored',
      scored: 4,
      metadata,
      items: [
        { ticket: ticket('c'), score: 0.99, bucket: 'strong' },
        { ticket: ticket('d'), score: 0.5, bucket: 'possible' },
      ],
    };
    state = applySmartSearchEvent(applySmartSearchEvent(state, first), second);

    // 'c' scored higher than 'a' but arrived later, so it stays second.
    expect(state.buckets.strong.map((i) => i.ticket.ticket_id)).toEqual(['a', 'c']);
    expect(state.buckets.possible.map((i) => i.ticket.ticket_id)).toEqual(['d']);
    expect(state.buckets.unlikely.map((i) => i.ticket.ticket_id)).toEqual(['b']);
    expect(state.scored).toBe(4);
  });

  it('collects failed ticket ids and finishes on done', () => {
    let state = applySmartSearchEvent(initial, { type: 'started', searchId: 's', total: 3 });
    state = applySmartSearchEvent(state, { type: 'batch_failed', ticketIds: ['x', 'y'], reason: 'boom', failed: 2 });
    expect(state.unscoredTicketIds).toEqual(['x', 'y']);
    expect(state.failed).toBe(2);

    state = applySmartSearchEvent(state, {
      type: 'done',
      total: 3,
      scored: 1,
      failed: 2,
      requests: 2,
      inputTokens: 250,
      model: 'jev-1.13.0',
      durationMs: 10,
    });
    expect(state.status).toBe('done');
    expect(state.inputTokens).toBe(250);
  });
});
