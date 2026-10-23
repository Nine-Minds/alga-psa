/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DEFAULT_CLIENT_PORTAL_CONFIG, type IClientPortalConfig } from '@alga-psa/types';

// The summary sentence is assembled by interpolation, which needs a translator that interpolates.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const values = (typeof fallback === 'object' && fallback !== null ? fallback : options) as Record<string, unknown> | undefined;
      const template = typeof fallback === 'string' ? fallback : String(values?.defaultValue ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(values?.[name] ?? ''));
    },
  }),
}));

import ClientPortalConfigEditor from '../ClientPortalConfigEditor';

afterEach(cleanup);

const config = (fields: string[]): IClientPortalConfig => ({
  ...DEFAULT_CLIENT_PORTAL_CONFIG,
  show_phases: true,
  show_tasks: true,
  visible_task_fields: fields,
});

describe('ClientPortalConfigEditor — summary of what clients see', () => {
  it('lists start dates, ahead of due dates, only when the field is enabled', () => {
    const { rerender } = render(
      <ClientPortalConfigEditor config={config(['task_name', 'start_date', 'due_date'])} onChange={() => {}} />,
    );
    const enabled = document.body.textContent ?? '';
    expect(enabled).toContain('start dates');
    expect(enabled.indexOf('start dates')).toBeLessThan(enabled.indexOf('due dates'));

    rerender(<ClientPortalConfigEditor config={config(['task_name', 'due_date'])} onChange={() => {}} />);
    expect(document.body.textContent).not.toContain('start dates');
    expect(document.body.textContent).toContain('due dates');
  });
});
