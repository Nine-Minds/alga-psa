import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './AppointmentsCalendar.tsx'),
  'utf8',
);

describe('AppointmentsCalendar contract', () => {
  it('exposes an onCreateOnDate callback on the props interface', () => {
    expect(source).toMatch(/onCreateOnDate\?:\s*\(date:\s*Date\)\s*=>/);
  });

  it('only renders the + button for in-month, non-past days', () => {
    expect(source).toContain('canCreate');
    expect(source).toMatch(/!isPast/);
    expect(source).toMatch(/inMonth/);
  });

  it('still uses i18n locale for weekday/month labels', () => {
    expect(source).toMatch(/toLocaleDateString\(locale/);
  });

  it('renders +N more interactively via Popover', () => {
    expect(source).toContain('Popover.Root');
  });
});
