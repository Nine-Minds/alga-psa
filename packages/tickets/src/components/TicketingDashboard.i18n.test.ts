// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticketing dashboard i18n wiring contract', () => {
  it('T010: wires the dashboard shell and primary filter chrome through features/tickets translations', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('dashboard.title', 'Ticketing Dashboard')");
    expect(source).toContain("t('dashboard.addTicket', 'Add Ticket')");
    expect(source).toContain("t('dashboard.filters.allAssignees', 'All Assignees')");
    expect(source).toContain("t('dashboard.filters.selectStatus', 'Select Status')");
    expect(source).toContain("t('dashboard.filters.responseState', 'Response State')");
    expect(source).toContain("t('responseState.awaitingClient', 'Awaiting Client')");
    expect(source).toContain("t('responseState.awaitingInternal', 'Awaiting Internal')");
    expect(source).toContain("t('filters.allPriorities', 'All Priorities')");
    expect(source).toContain("t('dashboard.filters.allDueDates', 'All Due Dates')");
    expect(source).toContain("t('dashboard.filters.dueDate', 'Due Date')");
    expect(source).toContain("t('dashboard.filters.slaStatus', 'SLA Status')");
    expect(source).toContain("t('filters.category', 'Filter by category')");
    expect(source).toContain("t('filters.search', 'Search tickets...')");
    expect(source).toContain("t('resetFilters', 'Reset')");
    expect(source).toContain("t('dashboard.bundledToggle', 'Bundled')");
    expect(source).toContain("t('dashboard.spacing.compact', 'Compact')");
    expect(source).toContain("t('dashboard.spacing.spacious', 'Spacious')");
    expect(source).toContain("t('dashboard.spacing.decrease', 'Decrease ticket list spacing')");
    expect(source).toContain("t('dashboard.spacing.increase', 'Increase ticket list spacing')");
    expect(source).toContain("t('dashboard.spacing.reset', 'Reset ticket list spacing')");
  });
});
