// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import englishSettings from '../../../public/locales/en/msp/settings.json';

(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const found = key.split('.').reduce<unknown>((value, part) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, englishSettings);
      return typeof found === 'string'
        ? found.replace(/\{\{(\w+)\}\}/g, (_match, name) => options?.[name] ?? '')
        : key;
    },
  }),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

import { ManagedRoleBadge, ManagedRoleNotice } from '../../../../packages/auth/src/components/settings/policy/ManagedRoleNotice';

afterEach(cleanup);

describe('the read-only presentation of a capability-owned role (F004)', () => {
  it('labels the role "Managed by Co-managed IT" and points at the arrangement for board and project scope', () => {
    render(<ManagedRoleNotice role={{ managed_by: 'co-managed-seat' }} />);
    expect(screen.getByText('Managed by Co-managed IT')).toBeTruthy();
    expect(screen.getByText(/Alga manages this role/)).toBeTruthy();
    expect(screen.getByText(/which boards and projects a technician can reach/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Co-managed IT' }).getAttribute('href')).toBe('/msp/co-managed');
  });

  it('explains a locked permissions matrix in terms of the role', () => {
    render(<ManagedRoleNotice role={{ managed_by: 'co-managed-seat' }} roleName="Seat Technician" />);
    expect(screen.getByText(/permissions of Seat Technician are managed by Co-managed IT/)).toBeTruthy();
  });

  it('shows nothing for an ordinary role', () => {
    const { container } = render(<><ManagedRoleBadge role={{ managed_by: null }} /><ManagedRoleNotice role={{}} /></>);
    expect(container.textContent).toBe('');
  });
});
