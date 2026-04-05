// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, record);
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

  it('T011: keeps the dashboard shell/bulk chrome backed by xx pseudo-locale strings instead of raw English', () => {
    const source = read('./TicketingDashboard.tsx');
    const pseudo = readJson<Record<string, unknown>>('../../../../server/public/locales/xx/features/tickets.json');

    const pseudoKeys = [
      'dashboard.title',
      'dashboard.addTicket',
      'dashboard.filters.allAssignees',
      'dashboard.exportDisabledTooltip',
      'dashboard.drawer.clientLoadFailed',
      'bulk.move.dialogTitle',
      'bulk.delete.dialogTitle',
      'bulk.bundle.dialogTitle',
    ];

    for (const key of pseudoKeys) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(pseudo, key)).toBe('11111');
    }

    expect(getLeaf(pseudo, 'bulk.move.success_one')).toBe('11111 {{count}} 11111');
    expect(getLeaf(pseudo, 'bulk.move.success_other')).toBe('11111 {{count}} 11111');
    expect(getLeaf(pseudo, 'bulk.delete.success_one')).toBe('11111 {{count}} 11111');
    expect(getLeaf(pseudo, 'bulk.delete.success_other')).toBe('11111 {{count}} 11111');
  });
});
