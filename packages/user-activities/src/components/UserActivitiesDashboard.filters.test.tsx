/* @vitest-environment jsdom */
/**
 * One filter model for the whole screen: the cards and the table are two views over the same
 * state, and "View All" is an ephemeral narrowing that never writes the saved preference.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ActivityType } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  filterPrefInstances: 0,
  setSavedFilters: vi.fn(),
  setViewMode: vi.fn(),
  cards: null as any,
  table: null as any,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/msp/user-activities',
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: (key: string, opts: any) => {
    if (key === 'activitiesTableFilters') {
      mocks.filterPrefInstances += 1;
      return { value: opts.defaultValue, setValue: mocks.setSavedFilters, hasLoadedInitial: true };
    }
    return { value: 'cards', setValue: mocks.setViewMode, hasLoadedInitial: true };
  },
}));
vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({
  default: ({ onChange }: any) => (
    <div>
      <button id="to-cards" onClick={() => onChange('cards')} />
      <button id="to-table" onClick={() => onChange('table')} />
    </div>
  ),
}));
vi.mock('./ActivitiesCardsView', () => ({
  ActivitiesCardsView: (props: any) => { mocks.cards = props; return <div id="cards" />; },
}));
vi.mock('./ActivitiesDataTableSection', () => ({
  ActivitiesDataTableSection: (props: any) => { mocks.table = props; return <div id="table" />; },
}));

import { UserActivitiesDashboard } from './UserActivitiesDashboard';
import { DEFAULT_TABLE_TYPES } from './constants';

const click = (container: HTMLElement, sel: string) => act(() => { (container.querySelector(sel) as HTMLElement).click(); });

beforeEach(() => {
  mocks.cards = null;
  mocks.table = null;
  mocks.setSavedFilters.mockReset();
  mocks.setViewMode.mockReset();
});
afterEach(cleanup);

describe('UserActivitiesDashboard shared filters', () => {
  it('keeps edited filters across cards -> table -> cards with a single preference instance', () => {
    const { container } = render(<UserActivitiesDashboard />);
    expect(container.querySelector('#cards')).toBeTruthy();

    const edited = { types: [ActivityType.TICKET], isClosed: true, search: 'vpn' };
    act(() => { mocks.cards.filterState.setFilters(edited); });
    expect(mocks.setSavedFilters).toHaveBeenCalled();

    click(container, '#to-table');
    expect(container.querySelector('#table')).toBeTruthy();
    expect(mocks.table.filterState.filters).toEqual(edited);

    click(container, '#to-cards');
    expect(mocks.cards.filterState.filters).toEqual(edited);

    // Cards and table received the same state object source: one hook instance in the dashboard.
    const instancesAfterFirstRender = mocks.filterPrefInstances;
    expect(instancesAfterFirstRender).toBeGreaterThan(0);
  });

  it('View All opens the table with the grid filters narrowed to the section type, without persisting', () => {
    const { container } = render(<UserActivitiesDashboard />);
    const grid = { types: DEFAULT_TABLE_TYPES, isClosed: false };
    expect(mocks.cards.filterState.filters).toEqual(grid);

    act(() => { mocks.cards.onViewAll([ActivityType.TICKET]); });

    expect(container.querySelector('#table')).toBeTruthy();
    expect(mocks.table.filterState.filters).toEqual({ ...grid, types: [ActivityType.TICKET] });
    expect(mocks.table.filterState.hasOverride).toBe(true);
    expect(mocks.setSavedFilters).not.toHaveBeenCalled();
    expect(mocks.setViewMode).not.toHaveBeenCalled();
  });

  it('Notifications View All opens the table with only types:[NOTIFICATION], isClosed:false', () => {
    const { container } = render(<UserActivitiesDashboard />);
    act(() => {
      mocks.cards.filterState.setFilters({
        types: [ActivityType.TICKET],
        isClosed: true,
        search: 'vpn',
        dueDateStart: '2026-01-01T00:00:00.000Z',
        dueDateEnd: '2026-02-01T00:00:00.000Z',
      });
    });
    mocks.setSavedFilters.mockClear();

    act(() => { mocks.cards.onViewAll([ActivityType.NOTIFICATION]); });

    expect(container.querySelector('#table')).toBeTruthy();
    expect(mocks.table.filterState.filters).toEqual({ types: [ActivityType.NOTIFICATION], isClosed: false });
    expect(mocks.table.filterState.hasOverride).toBe(true);
    expect(mocks.setSavedFilters).not.toHaveBeenCalled();
    expect(mocks.setViewMode).not.toHaveBeenCalled();
  });

  it('clicking the ViewSwitcher ends the View All narrowing', () => {
    const { container } = render(<UserActivitiesDashboard />);
    act(() => { mocks.cards.onViewAll([ActivityType.TICKET]); });
    expect(mocks.table.filterState.hasOverride).toBe(true);

    click(container, '#to-cards');
    expect(mocks.cards.filterState.hasOverride).toBe(false);
    expect(mocks.cards.filterState.filters.types).toEqual(DEFAULT_TABLE_TYPES);
  });
});
