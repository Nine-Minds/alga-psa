// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticket info i18n wiring contract', () => {
  it('T030: routes the detail header and core field chrome through features/tickets translations', () => {
    const source = read('./TicketInfo.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('info.editTitle', 'Edit title')");
    expect(source).toContain("t('info.unsavedChanges', 'You have unsaved changes. Click \"Save Changes\" to apply them.')");
    expect(source).toContain("t('fields.status', 'Status')");
    expect(source).toContain("t('fields.assignedTo', 'Assigned To')");
    expect(source).toContain("t('info.board', 'Board')");
    expect(source).toContain("t('fields.category', 'Category')");
    expect(source).toContain("t('info.itilCategory', 'ITIL Category')");
    expect(source).toContain("t('itil.impact', 'Impact')");
    expect(source).toContain("t('itil.urgency', 'Urgency')");
    expect(source).toContain("t('fields.priority', 'Priority')");
    expect(source).toContain("t('fields.dueDate', 'Due Date')");
    expect(source).toContain("t('info.slaStatus', 'SLA Status')");
    expect(source).toContain("t('settings.display.columns.tags', 'Tags')");
    expect(source).toContain("t('fields.description', 'Description')");
  });
});
