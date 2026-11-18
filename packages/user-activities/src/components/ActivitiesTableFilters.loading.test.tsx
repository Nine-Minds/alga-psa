/* @vitest-environment jsdom */
/**
 * alga-2026-0003109: the tag, project, board and status controls render while their lists load
 * (disabled, "Loading…") instead of popping in late; they hide only when a loaded list is empty.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActivityType } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: () => null }));
vi.mock('@alga-psa/ui/components/SearchInput', () => ({ SearchInput: () => null }));
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  StringDateRangePicker: ({ id }: any) => <input data-testid={`date-${id}`} />,
  parseLocalYMD: (s: string) => new Date(s),
  formatLocalYMD: (d: Date) => d.toISOString().slice(0, 10),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => <input data-testid="client-picker" /> }));
vi.mock('@alga-psa/ui/components/TreeSelect', () => ({
  default: (props: any) => (
    <button data-testid={props['data-automation-id']} disabled={!!props.disabled} data-options={props.options.length}>{props.placeholder}</button>
  ),
}));
vi.mock('@alga-psa/ui/context', () => ({ useClientPickerSearch: () => ({ searchClients: vi.fn() }) }));
vi.mock('@alga-psa/ui/components', () => ({
  TagFilter: ({ id, disabled, triggerLabel, tags }: any) => (
    <button data-testid={id} disabled={!!disabled} data-tags={tags.length}>{triggerLabel}</button>
  ),
}));

import { ActivitiesTableFilters } from './filters/ActivitiesTableFilters';

afterEach(cleanup);

const filters = { types: [ActivityType.TICKET, ActivityType.PROJECT_TASK] };
const IDS = ['activities-board-filter', 'activities-ticket-status-filter', 'ticket-tag-filter', 'activities-project-filter', 'project-task-tag-filter'];
const allLoading = { boards: true, ticketStatuses: true, ticketTags: true, projects: true, projectTaskTags: true };
const allLoaded = { boards: false, ticketStatuses: false, ticketTags: false, projects: false, projectTaskTags: false };

describe('ActivitiesTableFilters option loading states', () => {
  it('while lists load: renders every control disabled with "Loading…"', () => {
    render(<ActivitiesTableFilters filters={filters} onChange={vi.fn()} loading={allLoading} />);
    for (const id of IDS) {
      const el = screen.getByTestId(id) as HTMLButtonElement;
      expect(el.disabled).toBe(true);
      expect(el.textContent).toBe('Loading…');
    }
  });

  it('keeps client and date controls interactive while lists load', () => {
    render(<ActivitiesTableFilters filters={filters} onChange={vi.fn()} loading={allLoading} />);
    expect((screen.getByTestId('client-picker') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByTestId('date-activities-due-date-range') as HTMLInputElement).disabled).toBe(false);
  });

  it('a loaded empty list hides its control', () => {
    render(<ActivitiesTableFilters filters={filters} onChange={vi.fn()} loading={allLoaded} />);
    for (const id of IDS) expect(screen.queryByTestId(id)).toBeNull();
  });

  it('a loaded list with options enables its control', () => {
    render(
      <ActivitiesTableFilters
        filters={filters}
        onChange={vi.fn()}
        loading={allLoaded}
        boards={[{ board_id: 'b1', board_name: 'Support' }]}
        ticketStatuses={[{ status_id: 's1', name: 'Open', board_id: 'b1' } as any]}
        ticketTags={[{ tag_id: 't1', tag_text: 'vip', tagged_type: 'ticket' } as any]}
        projects={[{ project_id: 'p1', project_name: 'Migration', is_inactive: false, phases: [] } as any]}
        projectTaskTags={[{ tag_id: 't2', tag_text: 'bug', tagged_type: 'project_task' } as any]}
      />
    );
    for (const id of IDS) {
      const el = screen.getByTestId(id) as HTMLButtonElement;
      expect(el.disabled).toBe(false);
      expect(el.textContent).not.toBe('Loading…');
    }
  });

  it('lists loading independently: loaded controls are enabled while others still load', () => {
    render(
      <ActivitiesTableFilters
        filters={filters}
        onChange={vi.fn()}
        loading={{ ...allLoaded, projects: true }}
        boards={[{ board_id: 'b1', board_name: 'Support' }]}
      />
    );
    expect((screen.getByTestId('activities-board-filter') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('activities-project-filter') as HTMLButtonElement).disabled).toBe(true);
  });
});
