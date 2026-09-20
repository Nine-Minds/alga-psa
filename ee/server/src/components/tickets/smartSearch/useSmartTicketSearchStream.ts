'use client';

/**
 * Consumes the smart ticket search stream and keeps the bucketed result state.
 *
 * Buckets are append-only: a scored ticket lands in its bucket in arrival order
 * and never moves, so the user can scan and act on rows while later batches are
 * still scoring. A new `run` aborts the previous one; a generation counter
 * guards against a late frame from an aborted run touching the state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ITicketListFilters, ITicketListItem } from '@alga-psa/types';
import {
  SMART_TICKET_SEARCH_STREAM_PATH,
  type SmartSearchBucket,
  type SmartSearchEvent,
  type SmartSearchRowMetadata,
  type SmartSearchScoredItem,
  type SmartTicketSearchErrorCode,
  type SmartTicketSearchRequestBody,
} from '@alga-psa/tickets/lib/smartTicketSearch/types';

export type SmartSearchStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface SmartSearchBuckets {
  strong: SmartSearchScoredItem[];
  possible: SmartSearchScoredItem[];
  unlikely: SmartSearchScoredItem[];
}

export interface SmartSearchState {
  status: SmartSearchStatus;
  total: number;
  scored: number;
  failed: number;
  buckets: SmartSearchBuckets;
  /** Ticket ids from failed batches, in arrival order. Hydrated by the panel. */
  unscoredTicketIds: string[];
  error: { code: SmartTicketSearchErrorCode | 'STREAM_INTERRUPTED'; message: string } | null;
  /** Token usage reported by the server on completion. */
  inputTokens: number | null;
}

const EMPTY_BUCKETS = (): SmartSearchBuckets => ({ strong: [], possible: [], unlikely: [] });

const INITIAL_STATE: SmartSearchState = {
  status: 'idle',
  total: 0,
  scored: 0,
  failed: 0,
  buckets: EMPTY_BUCKETS(),
  unscoredTicketIds: [],
  error: null,
  inputTokens: null,
};

export interface UseSmartTicketSearchStreamOptions {
  /** Rows arrive with the tags and avatar urls the table needs; the dashboard merges them. */
  onRowMetadata?: (metadata: SmartSearchRowMetadata) => void;
}

export interface UseSmartTicketSearchStream {
  state: SmartSearchState;
  run: (filters: ITicketListFilters, query: string) => void;
  cancel: () => void;
  reset: () => void;
}

type ParsedFrame = { event: string; data: string };

/**
 * Splits an SSE byte stream into frames. Exported for tests. Each frame is the
 * text between blank lines; `event:` and `data:` lines are collected, comment
 * lines (`: keepalive`) are ignored.
 */
export function parseSseFrames(buffer: string): { frames: ParsedFrame[]; rest: string } {
  const frames: ParsedFrame[] = [];
  let rest = buffer;
  let boundary = rest.indexOf('\n\n');
  while (boundary !== -1) {
    const raw = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
    if (dataLines.length > 0) {
      frames.push({ event, data: dataLines.join('\n') });
    }
    boundary = rest.indexOf('\n\n');
  }
  return { frames, rest };
}

function appendToBucket(buckets: SmartSearchBuckets, bucket: SmartSearchBucket, items: SmartSearchScoredItem[]): SmartSearchBuckets {
  if (items.length === 0) {
    return buckets;
  }
  return { ...buckets, [bucket]: [...buckets[bucket], ...items] };
}

export function applySmartSearchEvent(state: SmartSearchState, event: SmartSearchEvent): SmartSearchState {
  switch (event.type) {
    case 'started':
      return { ...state, status: 'running', total: event.total, scored: 0, failed: 0 };
    case 'scored': {
      let buckets = state.buckets;
      for (const bucket of ['strong', 'possible', 'unlikely'] as const) {
        buckets = appendToBucket(buckets, bucket, event.items.filter((item) => item.bucket === bucket));
      }
      return { ...state, buckets, scored: event.scored };
    }
    case 'batch_failed':
      return {
        ...state,
        failed: event.failed,
        unscoredTicketIds: [...state.unscoredTicketIds, ...event.ticketIds],
      };
    case 'done':
      return {
        ...state,
        status: 'done',
        total: event.total,
        scored: event.scored,
        failed: event.failed,
        inputTokens: event.inputTokens,
      };
    default:
      return state;
  }
}

export function useSmartTicketSearchStream(options: UseSmartTicketSearchStreamOptions = {}): UseSmartTicketSearchStream {
  const [state, setState] = useState<SmartSearchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const onRowMetadataRef = useRef(options.onRowMetadata);
  onRowMetadataRef.current = options.onRowMetadata;

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    setState((prev) => (prev.status === 'running' ? { ...prev, status: 'cancelled' } : prev));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    setState({ ...INITIAL_STATE, buckets: EMPTY_BUCKETS() });
  }, []);

  const run = useCallback((filters: ITicketListFilters, query: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const isCurrent = () => generationRef.current === generation && !controller.signal.aborted;

    setState({ ...INITIAL_STATE, status: 'running', buckets: EMPTY_BUCKETS() });

    const body: SmartTicketSearchRequestBody = { filters: { ...filters, searchQuery: '' }, query };

    (async () => {
      let response: Response;
      try {
        response = await fetch(SMART_TICKET_SEARCH_STREAM_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: { code: 'STREAM_INTERRUPTED', message: error instanceof Error ? error.message : 'Network error' },
        }));
        return;
      }

      if (!response.ok) {
        let code: SmartTicketSearchErrorCode = 'INTERNAL_ERROR';
        let message = `Smart search failed (${response.status})`;
        try {
          const parsed = (await response.json()) as { code?: string; error?: string };
          if (typeof parsed.code === 'string') {
            code = parsed.code as SmartTicketSearchErrorCode;
          }
          if (typeof parsed.error === 'string') {
            message = parsed.error;
          }
        } catch {
          // body was not JSON; keep the status-derived message
        }
        if (isCurrent()) {
          setState((prev) => ({ ...prev, status: 'error', error: { code, message } }));
        }
        return;
      }

      if (!response.body) {
        if (isCurrent()) {
          setState((prev) => ({ ...prev, status: 'error', error: { code: 'STREAM_INTERRUPTED', message: 'Empty response' } }));
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDone = false;

      const handleFrame = (frame: ParsedFrame) => {
        if (frame.data === '[DONE]') {
          sawDone = true;
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(frame.data);
        } catch {
          return;
        }
        if (frame.event === 'error') {
          const err = payload as { code?: string; error?: string };
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: {
              code: (typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR') as SmartTicketSearchErrorCode,
              message: typeof err.error === 'string' ? err.error : 'Smart search failed',
            },
          }));
          return;
        }
        const event = payload as SmartSearchEvent;
        if (event.type === 'scored') {
          onRowMetadataRef.current?.(event.metadata);
        }
        setState((prev) => applySmartSearchEvent(prev, event));
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseSseFrames(buffer);
          buffer = rest;
          if (!isCurrent()) {
            return;
          }
          frames.forEach(handleFrame);
        }
        buffer += decoder.decode();
        if (buffer.trim().length > 0) {
          const { frames } = parseSseFrames(`${buffer}\n\n`);
          if (isCurrent()) {
            frames.forEach(handleFrame);
          }
        }
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: { code: 'STREAM_INTERRUPTED', message: error instanceof Error ? error.message : 'Stream interrupted' },
        }));
        return;
      }

      if (!isCurrent()) {
        return;
      }
      setState((prev) => {
        if (prev.status !== 'running') {
          return prev;
        }
        // The connection closed without a `done` event: keep what arrived, say so.
        return {
          ...prev,
          status: 'error',
          error: {
            code: 'STREAM_INTERRUPTED',
            message: sawDone ? 'The search ended before all tickets were scored' : 'The connection closed before the search finished',
          },
        };
      });
    })();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, run, cancel, reset };
}
