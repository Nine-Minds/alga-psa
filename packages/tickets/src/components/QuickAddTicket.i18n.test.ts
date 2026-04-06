// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('quick add ticket i18n wiring contract', () => {
  it('T020: wires the dialog shell, field labels, and primary placeholders through features/tickets translations', () => {
    const source = read('./QuickAddTicket.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('quickAdd.dialogLabel', 'Quick Add Ticket Dialog')");
    expect(source).toContain("t('quickAdd.dialogTitle', 'Quick Add Ticket')");
    expect(source).toContain("t('quickAdd.formLabel', 'Quick Add Ticket Form')");
    expect(source).toContain("t('quickAdd.titlePlaceholder', 'Ticket Title *')");
    expect(source).toContain("t('quickAdd.descriptionLabel', 'Description')");
    expect(source).toContain("t('quickAdd.descriptionPlaceholder', 'Description')");
    expect(source).toContain("t('quickAdd.clientPlaceholder', 'Select Client *')");
    expect(source).toContain("t('quickAdd.selectContact', 'Select contact')");
    expect(source).toContain("t('quickAdd.selectLocation', 'Select location')");
    expect(source).toContain("t('quickAdd.boardPlaceholder', 'Select Board *')");
    expect(source).toContain("t('quickAdd.assignedTo', 'Assigned To')");
    expect(source).toContain("t('quickAdd.additionalAgents', 'Additional Agents')");
    expect(source).toContain("t('quickAdd.selectCategory', 'Select category')");
    expect(source).toContain("t('quickAdd.statusPlaceholder', 'Select Status *')");
    expect(source).toContain("t('quickAdd.selectPriority', 'Select Priority *')");
    expect(source).toContain("t('quickAdd.dueDate', 'Due Date')");
    expect(source).toContain("t('quickAdd.selectDate', 'Select date')");
    expect(source).toContain("t('quickAdd.timePlaceholder', 'Time')");
  });
});
