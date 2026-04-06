// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticket export dialog i18n wiring contract', () => {
  it('T060: routes the export configuration chrome through features/tickets translations', () => {
    const source = read('./TicketExportDialog.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('export.title', 'Export Tickets')");
    expect(source).toContain("t('export.selectedTicketsSummary', 'Exporting {{count}} selected ticket'");
    expect(source).toContain("t('export.appliedFiltersSummary', '(of {{count}} ticket matching applied filters)'");
    expect(source).toContain("t('export.fieldsTitle', 'Fields to export')");
    expect(source).toContain("t('export.selectAll', 'Select all')");
    expect(source).toContain("t('export.deselectAll', 'Deselect all')");
    expect(source).toContain("t('export.selectedCount', '{{selected}} of {{total}} fields selected'");
    expect(source).toContain("t('export.confirm', 'Export {{count}} Ticket', { count: exportCount })");
    expect(source).toContain("labelKey: 'fields.ticketNumber'");
    expect(source).toContain("labelKey: 'properties.contact'");
    expect(source).toContain("labelKey: 'settings.display.columns.tags'");
  });
});
