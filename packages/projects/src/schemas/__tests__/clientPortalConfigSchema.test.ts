/* @vitest-environment node */

import { describe, it, expect } from 'vitest';
import { clientPortalConfigSchema } from '../project.schemas';
import { DEFAULT_CLIENT_PORTAL_CONFIG } from '@alga-psa/types';

describe('clientPortalConfigSchema — show_budget_hours', () => {
  it('accepts show_budget_hours=true', () => {
    const parsed = clientPortalConfigSchema.parse({
      show_phases: false,
      show_phase_completion: false,
      show_tasks: false,
      show_budget_hours: true,
      visible_task_fields: ['task_name']
    });
    expect(parsed.show_budget_hours).toBe(true);
  });

  it('accepts show_budget_hours=false', () => {
    const parsed = clientPortalConfigSchema.parse({
      show_phases: false,
      show_phase_completion: false,
      show_tasks: false,
      show_budget_hours: false,
      visible_task_fields: ['task_name']
    });
    expect(parsed.show_budget_hours).toBe(false);
  });

  it('defaults show_budget_hours to false when field is omitted', () => {
    const parsed = clientPortalConfigSchema.parse({});
    expect(parsed.show_budget_hours).toBe(false);
  });

  it('rejects non-boolean show_budget_hours', () => {
    expect(() =>
      clientPortalConfigSchema.parse({ show_budget_hours: 'yes' })
    ).toThrow();
  });
});

describe('DEFAULT_CLIENT_PORTAL_CONFIG', () => {
  it('has show_budget_hours set to false (hidden by default)', () => {
    expect(DEFAULT_CLIENT_PORTAL_CONFIG.show_budget_hours).toBe(false);
  });

  it('matches the other visibility flags — all start hidden', () => {
    expect(DEFAULT_CLIENT_PORTAL_CONFIG.show_phases).toBe(false);
    expect(DEFAULT_CLIENT_PORTAL_CONFIG.show_tasks).toBe(false);
    expect(DEFAULT_CLIENT_PORTAL_CONFIG.show_phase_completion).toBe(false);
    expect(DEFAULT_CLIENT_PORTAL_CONFIG.show_budget_hours).toBe(false);
  });
});
