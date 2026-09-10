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
});
