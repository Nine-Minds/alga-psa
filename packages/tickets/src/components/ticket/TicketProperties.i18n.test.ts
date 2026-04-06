// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticket properties i18n wiring contract', () => {
  it('T040: routes the side-panel labels and select placeholders through features/tickets translations', () => {
    const source = read('./TicketProperties.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('properties.timeEntry', 'Time Entry')");
    expect(source).toContain("t('properties.ticketTimer', 'Ticket Timer - #{{ticketNumber}}', { ticketNumber: ticket.ticket_number })");
    expect(source).toContain("t('fields.description', 'Description')");
    expect(source).toContain("t('properties.enterWorkDescription', 'Enter work description')");
    expect(source).toContain("t('properties.contactInfo', 'Contact Info')");
    expect(source).toContain("t('properties.location', 'Location')");
    expect(source).toContain("t('properties.agentTeam', 'Agent team')");
    expect(source).toContain("t('properties.primaryAgent', 'Primary Agent')");
    expect(source).toContain("t('properties.additionalAgents', 'Additional Agents')");
    expect(source).toContain("t('properties.selectAdditionalAgents', 'Select additional agents...')");
    expect(source).toContain("t('quickAdd.addTeamMembers', 'Add Team Members')");
  });

  it('T041: routes the interactive team-assignment confirmation dialog through translations', () => {
    const source = read('./TicketProperties.tsx');

    expect(source).toContain("t('properties.switchTeamAssignment', 'Switch team assignment')");
    expect(source).toContain("t('properties.removeTeamAssignment', 'Remove team assignment')");
    expect(source).toContain("t('properties.removeTeamMode.removeAll', 'Remove all team members')");
    expect(source).toContain("t('properties.removeTeamMode.keepAll', 'Keep all team members as individual agents')");
    expect(source).toContain("t('properties.removeTeamMode.selective', 'Select individual members to keep/remove')");
    expect(source).toContain("t('properties.noTeamMembersFound', 'No team members found on this ticket.')");
    expect(source).toContain("t('actions.cancel', 'Cancel')");
    expect(source).toContain("t('actions.confirm', 'Confirm')");
  });
});
