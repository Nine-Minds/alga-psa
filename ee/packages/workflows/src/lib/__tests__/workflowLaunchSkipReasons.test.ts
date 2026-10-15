import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_LAUNCH_SKIP_INTENTIONAL,
  WORKFLOW_LAUNCH_SKIP_REASONS,
  isIntentionalLaunchSkipReason,
} from '../workflowLaunchSkipReasons';

const repoRoot = path.resolve(__dirname, '../../../../../..');
const migrationPath = path.join(repoRoot, 'server/migrations/20261010120000_create_workflow_event_launch_skips.cjs');
const localesRoot = path.join(repoRoot, 'server/public/locales');
const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'];

const migrationReasons = (): string[] => {
  const source = fs.readFileSync(migrationPath, 'utf8');
  const match = /const REASONS = \[([\s\S]*?)\];/.exec(source);
  if (!match) throw new Error('REASONS array not found in migration');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe('workflow launch skip reason taxonomy', () => {
  it('matches the migration CHECK list exactly (same members, same order)', () => {
    expect(migrationReasons()).toEqual([...WORKFLOW_LAUNCH_SKIP_REASONS]);
  });

  it('classifies exactly the four guard reasons as intentional', () => {
    const intentional = WORKFLOW_LAUNCH_SKIP_REASONS.filter((reason) => WORKFLOW_LAUNCH_SKIP_INTENTIONAL[reason]);
    expect(intentional.sort()).toEqual(['causation_depth_exceeded', 'lineage_loop_guard', 'paused', 'self_trigger_guard']);
    expect(isIntentionalLaunchSkipReason('launch_failed')).toBe(false);
    expect(isIntentionalLaunchSkipReason('paused')).toBe(true);
  });

  it.each(LOCALES)('has a label and hint for every reason in the %s locale', (locale) => {
    const file = path.join(localesRoot, locale, 'msp/workflows.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      launchSkipReasons?: Record<string, { label?: string; hint?: string }>;
    };
    for (const reason of WORKFLOW_LAUNCH_SKIP_REASONS) {
      expect(json.launchSkipReasons?.[reason]?.label, `${locale}:${reason}.label`).toBeTruthy();
      expect(json.launchSkipReasons?.[reason]?.hint, `${locale}:${reason}.hint`).toBeTruthy();
    }
  });
});
