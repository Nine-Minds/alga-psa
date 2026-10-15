// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

type TestRow = { id: string; title: string };

type MockScored = { row: TestRow; score: number; bucket: 'strong' };

interface MockState {
  status: 'done';
  total: number;
  scored: number;
  failed: number;
  buckets: { strong: MockScored[]; possible: MockScored[]; unlikely: MockScored[] };
  unscoredIds: string[];
  error: null;
  inputTokens: number | null;
}

let mockState: MockState;

vi.mock('../../components/smartSearch/useSmartSearchStream', () => ({
  useSmartSearchStream: () => ({
    state: mockState,
    run: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('features/tickets');
});

import { SmartSearchResults } from '../../components/smartSearch/SmartSearchResults';

function scored(rows: TestRow[]): MockScored[] {
  return rows.map((row) => ({ row, score: 0.9, bucket: 'strong' }));
}

function buildState(rows: TestRow[]): MockState {
  return {
    status: 'done',
    total: rows.length,
    scored: rows.length,
    failed: 0,
    buckets: { strong: scored(rows), possible: [], unlikely: [] },
    unscoredIds: [],
    error: null,
    inputTokens: 1,
  };
}

function makeElement(runToken: number) {
  const columns = [{ title: 'Title', dataIndex: 'title', sortable: true }];
  return (
    <SmartSearchResults
      id="test"
      entity="ticket"
      i18nNamespace="features/tickets"
      scope={{}}
      query="q"
      runToken={runToken}
      scopeStale={false}
      onRerun={() => {}}
      columns={columns}
      rowId={(row: TestRow) => row.id}
      hydrateRows={async () => ({ rows: [], metadata: { tags: {} } })}
      onExit={() => {}}
    />
  );
}

function panel(rows: TestRow[]) {
  mockState = buildState(rows);
  const view = render(makeElement(1));
  return { ...view, rerenderWith: (next: TestRow[], runToken: number) => {
    mockState = buildState(next);
    view.rerender(makeElement(runToken));
  } };
}

function rowTitles(): string[] {
  return Array.from(document.querySelectorAll('tbody tr')).map((tr) => (tr.querySelector('td')?.textContent ?? '').trim());
}

describe('SmartSearchResults append-only buckets', () => {
  it('does not sort a bucket on a header click and keeps later arrivals appended', () => {
    const a: TestRow = { id: 'a', title: 'Zulu' };
    const b: TestRow = { id: 'b', title: 'Yankee' };
    const c: TestRow = { id: 'c', title: 'Alpha' };

    const { rerenderWith } = panel([a, b]);
    expect(rowTitles()).toEqual(['Zulu', 'Yankee']);

    // The page's own Title column is sortable; the panel must neutralize it.
    const header = document.getElementById('test-smart-search-strong-table-header-title');
    expect(header).not.toBeNull();
    fireEvent.click(header!);

    // A later batch arrives with a title that would sort to the top. Arrival
    // order is the contract, so it stays last.
    rerenderWith([a, b, c], 2);

    expect(rowTitles()).toEqual(['Zulu', 'Yankee', 'Alpha']);
  });
});
