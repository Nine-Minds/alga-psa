/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ActivityType } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value }: any) => <div id={id} data-testid={id} data-value={value} />,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: () => null }));
vi.mock('@alga-psa/ui/components/SearchInput', () => ({ SearchInput: () => null }));
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  StringDateRangePicker: () => null,
  parseLocalYMD: (s: string) => new Date(s),
  formatLocalYMD: (d: Date) => d.toISOString().slice(0, 10),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/TreeSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components', () => ({ TagFilter: () => null }));

import { ActivitiesTableFilters } from './filters/ActivitiesTableFilters';

afterEach(cleanup);

const priorities = [
  { priority_id: 'p1', priority_name: 'High' },
  { priority_id: 'p2', priority_name: 'Low' },
] as any[];

describe('ActivitiesTableFilters priority select', () => {
  it('reflects filters.priorityIds when the prop changes after mount', () => {
    const base = { types: [ActivityType.TICKET] };
    const { rerender, getByTestId } = render(
      <ActivitiesTableFilters filters={base} onChange={vi.fn()} priorities={priorities} />
    );
    expect(getByTestId('priority-select').getAttribute('data-value')).toBe('all');

    rerender(
      <ActivitiesTableFilters filters={{ ...base, priorityIds: ['p2'] }} onChange={vi.fn()} priorities={priorities} />
    );
    expect(getByTestId('priority-select').getAttribute('data-value')).toBe('p2');

    rerender(<ActivitiesTableFilters filters={base} onChange={vi.fn()} priorities={priorities} />);
    expect(getByTestId('priority-select').getAttribute('data-value')).toBe('all');
  });
});
