import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../..');
const ceMigrationsDir = path.join(repoRoot, 'server', 'migrations');
const eeMigrationsDir = path.join(repoRoot, 'ee', 'server', 'migrations');
const calendarEeMigrationFiles = [
  '20251108120000_create_calendar_provider_tables.cjs',
  '20251108120100_create_calendar_vendor_config_tables.cjs',
  '20251108120200_create_calendar_event_mappings.cjs',
  '20260104123100_google_calendar_webhook_columns_and_nullable_oauth_fields.cjs',
];

describe('calendar migration ownership contracts', () => {
  it('T359/T360: keeps fresh CE installs on shared Microsoft binding schema without EE calendar table-creation migrations', () => {
    const ceMigrationFiles = new Set(fs.readdirSync(ceMigrationsDir));
    const sharedActionSource = fs.readFileSync(
      path.join(repoRoot, 'packages/integrations/src/actions/calendarActions.ts'),
      'utf8'
    );

    expect(ceMigrationFiles.has('20260307120000_create_microsoft_profiles.cjs')).toBe(true);
    expect(ceMigrationFiles.has('20260307143000_create_microsoft_profile_consumer_bindings.cjs')).toBe(true);
    expect(calendarEeMigrationFiles.every((file) => !ceMigrationFiles.has(file))).toBe(true);
    expect(sharedActionSource).toContain('calendarUnavailable');
    expect(sharedActionSource).toContain("import('@alga-psa/ee-calendar/actions')");
  });

  it('T361/T362: keeps fresh EE installs on the shared Microsoft binding schema while adding the EE calendar migrations and runtime entrypoints', () => {
    const eeMigrationFiles = new Set(fs.readdirSync(eeMigrationsDir));
    const eeActionSource = fs.readFileSync(
      path.join(repoRoot, 'packages/ee/src/lib/actions/integrations/calendarActions.ts'),
      'utf8'
    );

    expect(calendarEeMigrationFiles.every((file) => eeMigrationFiles.has(file))).toBe(true);
    expect(eeActionSource).toContain("@alga-psa/ee-calendar/actions");
  });
});
