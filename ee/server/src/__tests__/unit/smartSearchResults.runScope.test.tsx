// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

type TestScope = { id: string };
type TestRow = { id: string; title: string };

// A controllable stand-in for the stream hook: the test sets the state it wants
// rendered and rerenders, and every `run` call is recorded so we can prove how
// many requests a scope change versus a runToken bump produces.
const harness = vi.hoisted(() => ({
  state: null as unknown,
  runCalls: [] as Array<{ scope: unknown; query: string }>,
}));

vi.mock('../../components/smartSearch/useSmartSearchStream', () => ({
  useSmartSearchStream: () => ({
    state: harness.state,
    run: (scope: unknown, query: string) => {
      harness.runCalls.push({ scope, query });
    },
    cancel: () => {},
    reset: () => {},
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('features/tickets');
});

import { SmartSearchResults } from '../../components/smartSearch/SmartSearchResults';

function doneState(scopeId: string, overrides: Record<string, unknown> = {}) {
  return {
    status: 'done',
    total: 1,
    scored: 1,
    failed: 0,
    buckets: {
      strong: [{ row: { id: `row-${scopeId}`, title: `Title ${scopeId}` }, score: 0.9, bucket: 'strong' }],
      possible: [],
      unlikely: [],
    },
    unscoredIds: [] as string[],
    error: null,
    inputTokens: 1,
    ...overrides,
  };
}

interface ElementOptions {
  token?: number;
  scopeStale?: boolean;
  onRerun?: () => void;
  hydrateRows?: (scope: TestScope, ids: string[]) => Promise<unknown>;
}

function element(scope: TestScope, options: ElementOptions = {}) {
  const columns = [{ title: 'Title', dataIndex: 'title', sortable: true }];
  return (
    <SmartSearchResults<TestScope, TestRow, Record<string, never>>
      id="test"
      entity="ticket"
      i18nNamespace="features/tickets"
      scope={scope}
      query="q"
      runToken={options.token ?? 1}
      scopeStale={options.scopeStale ?? false}
      onRerun={options.onRerun ?? (() => {})}
      columns={columns}
      rowId={(row: TestRow) => row.id}
      hydrateRows={options.hydrateRows ?? (async () => ({ rows: [], metadata: {} }))}
      onExit={() => {}}
    />
  );
}

function rowTitles(): string[] {
  return Array.from(document.querySelectorAll('tbody tr')).map((tr) => (tr.querySelector('td')?.textContent ?? '').trim());
}

describe('SmartSearchResults run scope', () => {
  it('retains a completed run and makes no additional request when the scope changes with an unchanged runToken', async () => {
    harness.runCalls.length = 0;
    harness.state = doneState('a');

    const { rerender } = render(element({ id: 'a' }, { token: 1 }));
    await waitFor(() => expect(harness.runCalls).toHaveLength(1));
    expect(harness.runCalls[0]).toEqual({ scope: { id: 'a' }, query: 'q' });
    expect(rowTitles()).toContain('Title a');

    // The chips change; the run token does not. The panel must keep the run's
    // results and stay on its captured scope.
    harness.state = doneState('a');
    rerender(element({ id: 'b' }, { token: 1 }));

    expect(harness.runCalls).toHaveLength(1);
    expect(harness.runCalls[0]).toEqual({ scope: { id: 'a' }, query: 'q' });
    expect(rowTitles()).toContain('Title a');
    expect(rowTitles()).not.toContain('Title b');
  });

  it('starts exactly one new request with the updated scope on an explicit rerun and replaces the previous results', async () => {
    harness.runCalls.length = 0;
    harness.state = doneState('a');
    const onRerun = vi.fn();

    const { rerender } = render(element({ id: 'a' }, { token: 1, scopeStale: true, onRerun }));
    await waitFor(() => expect(harness.runCalls).toHaveLength(1));
    expect(rowTitles()).toContain('Title a');

    // The rerun affordance is the explicit action; it hands control back to the
    // page, which bumps the run token and captures the latest scope.
    fireEvent.click(document.getElementById('test-smart-search-rerun')!);
    expect(onRerun).toHaveBeenCalledTimes(1);

    harness.state = doneState('b');
    rerender(element({ id: 'b' }, { token: 2, onRerun }));

    await waitFor(() => expect(harness.runCalls).toHaveLength(2));
    expect(harness.runCalls[1]).toEqual({ scope: { id: 'b' }, query: 'q' });
    expect(rowTitles()).toContain('Title b');
    expect(rowTitles()).not.toContain('Title a');
  });

  it('hydrates unscored rows against the run\'s captured scope while the current filters are stale', async () => {
    harness.runCalls.length = 0;
    harness.state = doneState('a');
    const hydrateRows = vi.fn(async (_scope: TestScope, _ids: string[]) => ({ rows: [], metadata: {} }));

    const { rerender } = render(element({ id: 'a' }, { token: 1, hydrateRows }));
    await waitFor(() => expect(harness.runCalls).toHaveLength(1));
    expect(hydrateRows).not.toHaveBeenCalled();

    // The chips change, the token does not.
    harness.state = doneState('a');
    rerender(element({ id: 'b' }, { token: 1, hydrateRows }));

    // A late batch failure arrives for the still-active run. Hydration must use
    // the scope captured when the run started, not the stale current chips.
    harness.state = doneState('a', { failed: 1, unscoredIds: ['x'] });
    rerender(element({ id: 'b' }, { token: 1, hydrateRows }));

    await waitFor(() => expect(hydrateRows).toHaveBeenCalledTimes(1));
    expect(hydrateRows).toHaveBeenCalledWith({ id: 'a' }, ['x']);
  });
});
