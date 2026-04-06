// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('display settings i18n wiring contract', () => {
  it('T080: routes the column/toggle settings chrome through features/tickets translations', () => {
    const source = read('./DisplaySettings.tsx');

    expect(source).toContain("const { t, i18n } = useTranslation('features/tickets');");
    expect(source).toContain("t('settings.display.responseStateTrackingTitle', 'Response State Tracking')");
    expect(source).toContain("'settings.display.responseStateTrackingDescription'");
    expect(source).toContain("t('settings.display.preferencesTitle', 'Ticket Display Preferences')");
    expect(source).toContain("'settings.display.preferencesDescription'");
    expect(source).toContain("t('settings.display.dateTimeFormat', 'Date/Time Format')");
    expect(source).toContain("t('settings.display.columnsTitle', 'Ticket List Columns')");
    expect(source).toContain("t('settings.display.requiredSuffix', '(required)')");
    expect(source).toContain("t('settings.display.showTags', 'Show Tags')");
    expect(source).toContain("t('settings.display.tagsUnderTitle', 'Display under Title')");
    expect(source).toContain("t('settings.display.tagsSeparateColumn', 'Display in separate column')");
  });
});
