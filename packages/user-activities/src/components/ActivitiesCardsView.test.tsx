/* @vitest-environment jsdom */
/**
 * The cards view renders the table's own filter bar inline and hands the one shared filter
 * model to every visible section. Sections are stubbed: they record the props they receive.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ActivityType } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  sectionProps: {} as Record<string, any>,
  viewable: { canViewOthers: false, viewableUsers: [] as any[] },
  setSaved: vi.fn(),
  stub: (name: string, cardId: string) => (props: any) => {
    mocks.sectionProps[name] = props;
    return React.createElement('div', { id: cardId });
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: (_k: string, opts: any) => ({ value: opts.defaultValue, setValue: mocks.setSaved, hasLoadedInitial: true }),
}));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children, onClick, id }: any) => <div id={id} onClick={onClick}>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, label, checked, onChange }: any) => (
    <label><input type="checkbox" id={id} checked={!!checked} onChange={onChange} />{label}</label>
  ),
}));
vi.mock('@alga-psa/ui/components/SearchInput', () => ({
  SearchInput: ({ id, value, onChange }: any) => <input id={id} value={value} onChange={onChange} />,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  StringDateRangePicker: () => null,
  parseLocalYMD: (s: string) => new Date(s),
  formatLocalYMD: (d: Date) => d.toISOString().slice(0, 10),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/TreeSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components', () => ({ TagFilter: () => null }));
vi.mock('./ViewingUserPicker', () => ({
  ViewingUserPicker: ({ id, onChange }: any) => (
    <button id={id} onClick={() => onChange('other-user')}>pick</button>
  ),
}));
vi.mock('../hooks/useViewableUsers', () => ({ useViewableUsers: () => mocks.viewable }));

vi.mock('./ScheduleSection', () => ({ ScheduleSection: mocks.stub('schedule', 'schedule-activities-card') }));
vi.mock('./TicketsSection', () => ({ TicketsSection: mocks.stub('tickets', 'tickets-activities-card') }));
vi.mock('./ProjectsSection', () => ({ ProjectsSection: mocks.stub('projects', 'projects-activities-card') }));
vi.mock('./WorkflowTasksSection', () => ({ WorkflowTasksSection: mocks.stub('workflowTasks', 'workflow-tasks-activities-card') }));
vi.mock('./NotificationsSection', () => ({ NotificationsSection: mocks.stub('notifications', 'notifications-activities-card') }));

import { ActivitiesCardsView } from './ActivitiesCardsView';
import { useActivityFilterState } from '../hooks/useActivityFilterState';
import { DEFAULT_TABLE_TYPES } from './constants';

const emptyOptions = {
  priorities: [], clients: [], projects: [], boards: [], ticketStatuses: [], ticketTags: [], projectTaskTags: [],
};

function Harness({ focus = false, onViewAll = vi.fn() }: { focus?: boolean; onViewAll?: any }) {
  const filterState = useActivityFilterState();
  return <ActivitiesCardsView filterState={filterState} filterOptions={emptyOptions} focusNotifications={focus} onViewAll={onViewAll} />;
}

beforeEach(() => {
  mocks.sectionProps = {};
  mocks.viewable = { canViewOthers: false, viewableUsers: [] };
});
afterEach(cleanup);

describe('ActivitiesCardsView inline filters', () => {
  it('renders the table filter bar inline, with no Filter buttons or dialogs', () => {
    const { container, queryByRole, queryByText } = render(<Harness />);
    expect(container.querySelector('#activities-search-input')).toBeTruthy();
    expect(container.querySelector('#activity-type-ticket')).toBeTruthy();
    expect(container.querySelector('#show-closed')).toBeTruthy();
    expect(queryByRole('dialog')).toBeNull();
    expect(queryByText('Filter')).toBeNull();
  });

  it('unchecking Tickets hides the Tickets card only', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('#tickets-activities-card')).toBeTruthy();
    fireEvent.click(container.querySelector('#activity-type-ticket')!);
    expect(container.querySelector('#tickets-activities-card')).toBeNull();
    expect(container.querySelector('#projects-activities-card')).toBeTruthy();
    expect(container.querySelector('#schedule-activities-card')).toBeTruthy();
  });

  it('shows all four cards when no type is selected', () => {
    const { container } = render(<Harness />);
    for (const t of ['schedule', 'ticket', 'projectTask', 'workflowTask']) {
      const box = container.querySelector(`#activity-type-${t}`) as HTMLInputElement | null;
      if (box?.checked) fireEvent.click(box);
    }
    for (const id of ['schedule', 'tickets', 'projects', 'workflow-tasks']) {
      expect(container.querySelector(`#${id}-activities-card`)).toBeTruthy();
    }
  });

  it('search and Show closed reach every visible section', () => {
    const { container } = render(<Harness />);
    fireEvent.change(container.querySelector('#activities-search-input')!, { target: { value: 'printer' } });
    fireEvent.click(container.querySelector('#show-closed')!);
    for (const name of ['schedule', 'tickets', 'projects', 'workflowTasks']) {
      expect(mocks.sectionProps[name].filters).toMatchObject({ search: 'printer', isClosed: true });
    }
  });

  it('Reset restores the default types and open-only', () => {
    const { container } = render(<Harness />);
    fireEvent.click(container.querySelector('#show-closed')!);
    fireEvent.click(container.querySelector('#activity-type-ticket')!);
    fireEvent.click(container.querySelector('#reset-filters-button')!);
    expect(mocks.sectionProps.tickets.filters).toMatchObject({ types: DEFAULT_TABLE_TYPES, isClosed: false });
  });

  it('renders the bar in the focus layout too', () => {
    const { container } = render(<Harness focus />);
    expect(container.querySelector('#activities-search-input')).toBeTruthy();
    expect(container.querySelector('#notifications-activities-card')).toBeTruthy();
    expect(mocks.sectionProps.notifications.fullMode).toBe(true);
    // others are collapsed below it
    expect(container.querySelector('#tickets-activities-card')).toBeNull();
    act(() => { fireEvent.click(container.querySelector('#cards-tickets-header')!); });
    expect(container.querySelector('#tickets-activities-card')).toBeTruthy();
  });

  it('places the bar after Notifications and before the activity sections, in both layouts', () => {
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    for (const focus of [false, true]) {
      const { container, unmount } = render(<Harness focus={focus} />);
      const header = container.querySelector('#cards-notifications-header')!;
      const bar = container.querySelector('#activities-search-input')!;
      const schedule = container.querySelector('#schedule-activities-card');
      expect(before(header, bar)).toBe(true);
      if (schedule) expect(before(bar, schedule)).toBe(true);
      if (!focus) expect(before(bar, container.querySelector('#tickets-activities-card')!)).toBe(true);
      unmount();
    }
  });

  it('keeps the bar above the remaining sections when Schedule is hidden', () => {
    const { container } = render(<Harness />);
    fireEvent.click(container.querySelector('#activity-type-schedule')!);
    expect(container.querySelector('#schedule-activities-card')).toBeNull();
    const bar = container.querySelector('#activities-search-input')!;
    const tickets = container.querySelector('#tickets-activities-card')!;
    expect(!!(bar.compareDocumentPosition(tickets) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('View All passes the section type', () => {
    const onViewAll = vi.fn();
    render(<Harness onViewAll={onViewAll} />);
    mocks.sectionProps.tickets.onViewAll();
    expect(onViewAll).toHaveBeenCalledWith([ActivityType.TICKET]);
  });
});

describe('ActivitiesCardsView viewing another user', () => {
  it('is read-only: sections get readOnly + targetUserId and Notifications is hidden', () => {
    mocks.viewable = { canViewOthers: true, viewableUsers: [{ user_id: 'other-user' }] };
    const { container } = render(<Harness />);
    expect(container.querySelector('#notifications-activities-card')).toBeTruthy();
    expect(mocks.sectionProps.tickets.readOnly).toBe(false);

    fireEvent.click(container.querySelector('#cards-viewing-user')!);

    expect(container.querySelector('#notifications-activities-card')).toBeNull();
    for (const name of ['schedule', 'tickets', 'projects', 'workflowTasks']) {
      expect(mocks.sectionProps[name]).toMatchObject({ readOnly: true, targetUserId: 'other-user' });
    }
  });

  it('hides the picker without the view-others permission', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('#cards-viewing-user')).toBeNull();
  });
});
