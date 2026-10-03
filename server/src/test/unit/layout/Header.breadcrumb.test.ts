import { describe, expect, it } from 'vitest';
import { getMenuItemNameByPath } from '../../../components/layout/Header';

const translate = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? '');

describe('getMenuItemNameByPath', () => {
  it('prefers the most specific nested route for the maintenance breadcrumb', () => {
    expect(getMenuItemNameByPath('/msp/assets/maintenance', translate)).toBe('Maintenance');
  });

  it('preserves existing parent and nested route labels', () => {
    expect(getMenuItemNameByPath('/msp/assets', translate)).toBe('All Assets');
    expect(getMenuItemNameByPath('/msp/documents', translate)).toBe('All Documents');
  });

  it('uses the specific settings route instead of the settings landing page', () => {
    expect(getMenuItemNameByPath('/msp/settings/integrations', translate)).toBe('Integrations');
  });

  it('labels workflow run pages as Workflows instead of falling back to Dashboard', () => {
    expect(getMenuItemNameByPath('/msp/workflows/runs/3f2c9a8e-0000-4000-8000-000000000001', translate)).toBe('Workflows');
    expect(getMenuItemNameByPath('/msp/workflow-control', translate)).toBe('Control Panel');
  });
});
