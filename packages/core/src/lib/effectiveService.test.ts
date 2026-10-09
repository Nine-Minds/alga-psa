import { describe, expect, it } from 'vitest';
import {
  effectiveServiceIdSql,
  effectiveServiceNameSql,
  effectiveServiceSourceSql,
  isTimeEntryService,
  resolveEffectiveServiceSource,
  timeEntryServiceChoices,
} from './effectiveService';

const ALIASES = { task: 'pt', phase: 'pp', project: 'p' };
const CATALOG_ALIASES = { task: 'task_service', phase: 'phase_service', project: 'project_service' };

describe('effective service SQL fragments', () => {
  it('coalesces the id task → phase → project, in that order', () => {
    expect(effectiveServiceIdSql(ALIASES)).toBe(
      'COALESCE(pt.service_id, pp.service_id, p.service_id)'
    );
  });

  it('derives the source with the same precedence, and NULL when no level sets one', () => {
    expect(effectiveServiceSourceSql(ALIASES)).toBe(
      "CASE WHEN pt.service_id IS NOT NULL THEN 'task'"
      + " WHEN pp.service_id IS NOT NULL THEN 'phase'"
      + " WHEN p.service_id IS NOT NULL THEN 'project'"
      + ' ELSE NULL END'
    );
  });

  it('coalesces the name over the catalog joins in the same order as the id', () => {
    expect(effectiveServiceNameSql(CATALOG_ALIASES)).toBe(
      'COALESCE(task_service.service_name, phase_service.service_name, project_service.service_name)'
    );
  });
});

describe('resolveEffectiveServiceSource', () => {
  it('prefers the task service over the phase and project ones', () => {
    expect(resolveEffectiveServiceSource({ task: 'a', phase: 'b', project: 'c' })).toBe('task');
  });

  it('falls back to the phase service when the task sets none', () => {
    expect(resolveEffectiveServiceSource({ task: null, phase: 'b', project: 'c' })).toBe('phase');
  });

  it('falls back to the project service when neither task nor phase sets one', () => {
    expect(resolveEffectiveServiceSource({ task: null, phase: null, project: 'c' })).toBe('project');
  });

  it('returns null when no level sets a service', () => {
    expect(resolveEffectiveServiceSource({ task: null, phase: null, project: null })).toBeNull();
    expect(resolveEffectiveServiceSource({})).toBeNull();
  });
});

describe('time entry service eligibility', () => {
  const hourly = { service_id: 'svc-hourly', service_name: 'Basic Support', billing_method: 'hourly' };
  const fixed = { service_id: 'svc-fixed', service_name: 'Emerald City Security', billing_method: 'fixed' };
  const usage = { service_id: 'svc-usage', service_name: 'Rabbit Tracking', billing_method: 'usage' };

  it('only accepts hourly services, the one kind a time entry can be filed against', () => {
    expect(isTimeEntryService(hourly)).toBe(true);
    expect(isTimeEntryService(fixed)).toBe(false);
    expect(isTimeEntryService(usage)).toBe(false);
    expect(isTimeEntryService(undefined)).toBe(false);
    expect(isTimeEntryService({ service_id: 'x', service_name: 'x' })).toBe(false);
  });

  it('offers only hourly services as a default', () => {
    expect(timeEntryServiceChoices([hourly, fixed, usage])).toEqual([hourly]);
  });

  it('keeps an already stored ineligible default listed so it stays visible and clearable', () => {
    expect(timeEntryServiceChoices([hourly, fixed, usage], 'svc-fixed')).toEqual([hourly, fixed]);
  });

  it('ignores a selected id that is not in the catalog', () => {
    expect(timeEntryServiceChoices([hourly, fixed], 'svc-gone')).toEqual([hourly]);
    expect(timeEntryServiceChoices([hourly, fixed], null)).toEqual([hourly]);
  });
});
