import { describe, expect, it } from 'vitest';

import type { SmartSearchEvent } from '@alga-psa/ui/lib/smartSearch/types';

import {
  applySmartSearchEvent,
  initialSmartSearchState,
  parseSseFrames,
} from '../../components/smartSearch/useSmartSearchStream';

type Row = { id: string; title: string };
type Event = SmartSearchEvent<Row, { tags: Record<string, string[]> }>;

const row = (id: string): Row => ({ id, title: id });
const metadata = { tags: {} };

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
    let state = applySmartSearchEvent(initialSmartSearchState<Row>(), { type: 'started', searchId: 's', total: 4 } as Event);
    expect(state.status).toBe('running');

    const first: Event = {
      type: 'scored',
      scored: 2,
      metadata,
      items: [
        { row: row('a'), score: 0.9, bucket: 'strong' },
        { row: row('b'), score: 0.1, bucket: 'unlikely' },
      ],
    };
    const second: Event = {
      type: 'scored',
      scored: 4,
      metadata,
      items: [
        { row: row('c'), score: 0.99, bucket: 'strong' },
        { row: row('d'), score: 0.5, bucket: 'possible' },
      ],
    };
    state = applySmartSearchEvent(applySmartSearchEvent(state, first), second);

    // 'c' scored higher than 'a' but arrived later, so it stays second.
    expect(state.buckets.strong.map((i) => i.row.id)).toEqual(['a', 'c']);
    expect(state.buckets.possible.map((i) => i.row.id)).toEqual(['d']);
    expect(state.buckets.unlikely.map((i) => i.row.id)).toEqual(['b']);
    expect(state.scored).toBe(4);
  });

  it('collects failed ids and finishes on done', () => {
    let state = applySmartSearchEvent(initialSmartSearchState<Row>(), { type: 'started', searchId: 's', total: 3 } as Event);
    state = applySmartSearchEvent(state, { type: 'batch_failed', ids: ['x', 'y'], reason: 'boom', failed: 2 } as Event);
    expect(state.unscoredIds).toEqual(['x', 'y']);
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
    } as Event);
    expect(state.status).toBe('done');
    expect(state.inputTokens).toBe(250);
  });
});
