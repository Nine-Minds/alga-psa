// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticket watch list i18n wiring contract', () => {
  it('T090: routes watcher list chrome, actions, and empty state through features/tickets translations', () => {
    const source = read('./TicketWatchListCard.tsx');

    expect(source).toContain("const { t } = useTranslation('features/tickets');");
    expect(source).toContain("t('watchList.title', 'Watch List')");
    expect(source).toContain("t('watchList.tabs.contact', 'Contact')");
    expect(source).toContain("t('watchList.tabs.internal', 'Internal')");
    expect(source).toContain("t('watchList.tabs.email', 'Email')");
    expect(source).toContain("t('watchList.scope.ticketClient', 'Ticket client')");
    expect(source).toContain("t('watchList.scope.allContacts', 'All contacts')");
    expect(source).toContain("t('watchList.placeholders.selectUserOrTeam', 'Select user or team')");
    expect(source).toContain("t('watchList.placeholders.selectContact', 'Select contact')");
    expect(source).toContain("t('watchList.placeholders.email', 'name@example.com')");
    expect(source).toContain("t('watchList.addEmail', 'Add Email')");
    expect(source).toContain("t('watchList.addUser', 'Add User')");
    expect(source).toContain("t('watchList.addContact', 'Add Contact')");
    expect(source).toContain("t('watchList.empty', 'No watchers added.')");
    expect(source).toContain("t('watchList.removeWatcher', 'Remove watcher')");
  });
});
