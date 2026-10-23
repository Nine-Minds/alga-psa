/**
 * @vitest-environment jsdom
 *
 * Both API key tables used to paint their status cell with a hand-rolled span
 * (`bg-green-100` / `bg-red-100`), which keeps a light background in dark mode
 * and glows against the row. The cell must render the shared Badge, whose
 * colours come from the `--badge-*` tokens and so follow the theme.
 */
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDefinition } from '@alga-psa/types';

const captured = vi.hoisted(() => ({ columns: [] as ColumnDefinition<any>[] }));

const i18n = vi.hoisted(() => ({
  t: (key: string, fallback?: string) => {
    if (key.endsWith('status.active')) return 'Active';
    if (key.endsWith('status.inactive')) return 'Inactive';
    return fallback ?? key;
  },
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ columns }: any) => {
    captured.columns = columns;
    return null;
  },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: i18n.t }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: i18n.t }),
  useFormatters: () => ({ formatDate: () => '' }),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (error: unknown) => String(error),
  handleError: vi.fn(),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('lucide-react', () => ({ Search: () => null, RotateCcw: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <section>{children}</section> }));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ preserveCursor, ...props }: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({ DateTimePicker: () => null }));

vi.mock('@/lib/actions/apiKeyActions', () => ({
  listApiKeys: vi.fn(async () => []),
  createApiKey: vi.fn(),
  deactivateApiKey: vi.fn(),
  adminListApiKeys: vi.fn(async () => []),
  adminDeactivateApiKey: vi.fn(),
}));
vi.mock('@/lib/actions/apiKeyRateLimitActions', () => ({
  getApiRateLimitsForKeys: vi.fn(async () => ({})),
  setApiRateLimitForKey: vi.fn(),
  clearApiRateLimitForKey: vi.fn(),
}));

const LIGHT_ONLY_CLASSES = ['bg-green-100', 'bg-red-100'];

async function statusCellsFor(load: () => Promise<React.ReactElement>) {
  captured.columns = [];
  render(await load());
  await waitFor(() => expect(captured.columns.length).toBeGreaterThan(0));

  const statusColumn = captured.columns.find((column) => column.dataIndex === 'active');
  const renderCell = (statusColumn as { render?: Function } | undefined)?.render;
  expect(renderCell).toBeTypeOf('function');

  const cellFor = (active: boolean) =>
    render(<>{renderCell!(active, { api_key_id: 'key-1', active }, 0)}</>).container;

  return { active: cellFor(true), inactive: cellFor(false) };
}

describe('API key status pill', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ['the user table', async () => {
      const { default: ApiKeysSetup } = await import('@/components/settings/profile/ApiKeysSetup');
      return <ApiKeysSetup />;
    }],
    ['the admin table', async () => {
      const { default: AdminApiKeysSetup } = await import('@/components/settings/security/AdminApiKeysSetup');
      return <AdminApiKeysSetup />;
    }],
  ])('renders the token-driven Badge in %s', async (_label, load) => {
    const cells = await statusCellsFor(load as () => Promise<React.ReactElement>);

    expect(cells.active.textContent).toBe('Active');
    expect(cells.active.firstElementChild?.className).toContain('bg-[rgb(var(--badge-success-bg))]');
    expect(cells.active.firstElementChild?.className).toContain('text-[rgb(var(--badge-success-text))]');

    expect(cells.inactive.textContent).toBe('Inactive');
    expect(cells.inactive.firstElementChild?.className).toContain('bg-[rgb(var(--badge-error-bg))]');
    expect(cells.inactive.firstElementChild?.className).toContain('text-[rgb(var(--badge-error-text))]');

    for (const cell of [cells.active, cells.inactive]) {
      for (const lightOnly of LIGHT_ONLY_CLASSES) {
        expect(cell.querySelector(`.${CSS.escape(lightOnly)}`)).toBeNull();
      }
    }
  });
});
