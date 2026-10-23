import { describe, expect, it } from 'vitest';
import {
  migrationClaimLabel,
  migrationCreatedNothing,
  migrationOutcomeBadge,
  migrationSkipSentence,
} from '@/components/settings/migrations/migrationUi';
import type { MigrationEntityProgress, MigrationSkipProvenance } from '@/lib/migrations/types';

const translate = (
  _key: string,
  options: { defaultValue: string; [name: string]: unknown }
): string =>
  Object.entries(options).reduce(
    (text, [name, value]) =>
      name === 'defaultValue' ? text : text.split(`{{${name}}}`).join(String(value)),
    options.defaultValue
  );

function progress(overrides: Partial<MigrationEntityProgress> = {}): MigrationEntityProgress {
  return {
    phase: 1,
    state: 'completed',
    plannedCount: 0,
    appliedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    ...overrides,
  };
}

describe('migration results UI helpers', () => {
  it('flags a completed run that created nothing but skipped rows', () => {
    expect(
      migrationCreatedNothing('completed', {
        contacts: progress({ plannedCount: 2, skippedCount: 2 }),
      })
    ).toBe(true);
    expect(
      migrationCreatedNothing('completed', {
        contacts: progress({ plannedCount: 2, appliedCount: 2 }),
      })
    ).toBe(false);
    expect(migrationCreatedNothing('completed', { contacts: progress() })).toBe(false);
    expect(
      migrationCreatedNothing('applying', {
        contacts: progress({ skippedCount: 2 }),
      })
    ).toBe(false);
  });

  it('downgrades the create-nothing badge to a warning', () => {
    const warning = migrationOutcomeBadge(
      'completed',
      { contacts: progress({ plannedCount: 1, skippedCount: 1 }) },
      translate
    );
    expect(warning.variant).toBe('warning');
    expect(warning.label).toBe('Nothing imported');

    const normal = migrationOutcomeBadge(
      'completed',
      { contacts: progress({ appliedCount: 1 }) },
      translate
    );
    expect(normal.variant).toBe('success');
    expect(normal.label).toBe('Completed');
  });

  it('only claims same-package for skips it can attribute to this package', () => {
    expect(migrationSkipSentence(null, translate)).toBeNull();
    expect(
      migrationSkipSentence({ allSamePackage: true, skippedCount: 1, entries: [] }, translate)
    ).toContain('same package');

    const foreign: MigrationSkipProvenance = {
      allSamePackage: false,
      skippedCount: 1,
      entries: [{ migrationJobId: 'j1', sourceFileName: 'prior.amp', skippedCount: 1, samePackage: false }],
    };
    expect(migrationSkipSentence(foreign, translate)).toContain('prior.amp');
    expect(migrationSkipSentence(foreign, translate)).not.toContain('same package');

    const unknown: MigrationSkipProvenance = {
      allSamePackage: false,
      skippedCount: 1,
      entries: [{ migrationJobId: null, sourceFileName: null, skippedCount: 1, samePackage: false }],
    };
    expect(migrationSkipSentence(unknown, translate)).toContain('existing entities');
  });

  it('labels a skipped record with where it was already migrated', () => {
    expect(migrationClaimLabel(null, translate)).toBeNull();
    expect(
      migrationClaimLabel({ migrationJobId: 'j', sourceFileName: null, samePackage: true }, translate)
    ).toContain('this package');
    expect(
      migrationClaimLabel({ migrationJobId: 'j', sourceFileName: 'prior.amp', samePackage: false }, translate)
    ).toContain('prior.amp');
    expect(
      migrationClaimLabel({ migrationJobId: 'j', sourceFileName: null, samePackage: false }, translate)
    ).toContain('existing entity');
  });
});
