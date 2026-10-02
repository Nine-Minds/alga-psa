import { describe, expect, it } from 'vitest';
import {
  effectiveServiceIdSql,
  effectiveServiceNameSql,
  effectiveServiceSourceSql,
  resolveEffectiveServiceSource,
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
