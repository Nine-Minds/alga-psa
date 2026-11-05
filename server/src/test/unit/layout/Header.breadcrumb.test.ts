import { describe, expect, it } from 'vitest';
import { getBreadcrumbTrailByPath, getMenuItemNameByPath } from '../../../components/layout/Header';

const translate = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? '');

const trailNames = (path: string | null | undefined) =>
  getBreadcrumbTrailByPath(path, translate).map((crumb) => crumb.name);

describe('getMenuItemNameByPath', () => {
  it('prefers the most specific nested route for the maintenance breadcrumb', () => {
    expect(getMenuItemNameByPath('/msp/assets/maintenance', translate)).toBe('Maintenance');
  });

  it('preserves existing parent and nested route labels', () => {
    expect(getMenuItemNameByPath('/msp/assets', translate)).toBe('All Assets');
    expect(getMenuItemNameByPath('/msp/documents', translate)).toBe('All Documents');
  });

  it('labels the tickets list and the recurring tickets page', () => {
    expect(getMenuItemNameByPath('/msp/tickets', translate)).toBe('All Tickets');
    expect(getMenuItemNameByPath('/msp/tickets/recurring', translate)).toBe('Recurring Tickets');
    expect(getMenuItemNameByPath('/msp/tickets/recurring/new', translate)).toBe('Recurring Tickets');
  });

  it('uses the specific settings route instead of the settings landing page', () => {
    expect(getMenuItemNameByPath('/msp/settings/integrations', translate)).toBe('Integrations');
  });

  it('labels workflow run pages as Workflows instead of falling back to Dashboard', () => {
    expect(getMenuItemNameByPath('/msp/workflows/runs/3f2c9a8e-0000-4000-8000-000000000001', translate)).toBe('Workflows');
    expect(getMenuItemNameByPath('/msp/workflow-control', translate)).toBe('Control Panel');
  });
});

describe('getBreadcrumbTrailByPath', () => {
  it('names the parent section ahead of the sub-page', () => {
    expect(trailNames('/msp/assets/custody')).toEqual(['Assets', 'Equipment in custody']);
    expect(trailNames('/msp/assets/maintenance')).toEqual(['Assets', 'Maintenance']);
    expect(trailNames('/msp/tickets/recurring')).toEqual(['Tickets', 'Recurring Tickets']);
    expect(trailNames('/msp/knowledge-base')).toEqual(['Documents', 'Knowledge Base']);
  });

  it('leaves a top-level page as a single crumb', () => {
    expect(trailNames('/msp/clients')).toEqual(['Clients']);
    expect(trailNames('/msp/settings/integrations')).toEqual(['Integrations']);
  });

  it('keeps a nav group without a page of its own unlinked', () => {
    const trail = getBreadcrumbTrailByPath('/msp/assets/custody', translate);
    expect(trail[0].href).toBeUndefined();
    expect(trail[1].href).toBe('/msp/assets/custody');
  });

  it('falls back to the dashboard label for unknown routes', () => {
    expect(trailNames('/msp/not-a-route')).toEqual(['Dashboard']);
    expect(trailNames(null)).toEqual(['Dashboard']);
  });
});
