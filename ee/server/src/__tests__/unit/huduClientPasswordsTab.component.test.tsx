// @vitest-environment jsdom
/**
 * T081, T082, T083 — client "Passwords" tab component (client-passwords-tab
 * group). jsdom + @testing-library, mirroring huduClientTab.component.test
 * idioms: the data actions, i18n and UI primitives are mocked; assertions run
 * against the DOM. SECURITY focus: the value is absent before reveal, lives
 * only in component state after reveal, is gone after Hide/Refresh, and never
 * touches any console/logger.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HuduClientPasswordsTab } from '@ee/components/integrations/hudu/HuduClientPasswordsTab';
import type { HuduCompanyDataResult } from '@ee/lib/actions/integrations/huduDataActions';
import type { HuduAssetPasswordSummary } from '@ee/lib/integrations/hudu/contracts';

const { getHuduClientContextMock, getHuduCompanyPasswordsMock, revealHuduPasswordMock } =
  vi.hoisted(() => ({
    getHuduClientContextMock: vi.fn(),
    getHuduCompanyPasswordsMock: vi.fn(),
    revealHuduPasswordMock: vi.fn(),
  }));

// Same module as the component's relative import (vitest dedupes by resolved id).
vi.mock('@ee/lib/actions/integrations/huduDataActions', () => ({
  getHuduClientContext: getHuduClientContextMock,
  getHuduCompanyPasswords: getHuduCompanyPasswordsMock,
  revealHuduPassword: revealHuduPasswordMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <span id={id} data-variant={variant}>
      {children}
    </span>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button id={id} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const COMPANY_URL = 'https://docs.example.com/companies/101';
const SECRET_VALUE = 'S3cr3t-Hudu-V@lue-9000';

function okPasswords(): HuduCompanyDataResult<HuduAssetPasswordSummary> {
  return {
    state: 'ok',
    items: [
      {
        id: 11,
        company_id: 101,
        name: 'Domain Admin',
        username: 'admin@example.com',
        url: '/passwords/11',
        hudu_url: 'https://docs.example.com/passwords/11',
      },
      {
        id: 12,
        company_id: 101,
        name: 'Firewall Login',
        username: null,
        url: null,
        hudu_url: null,
      },
    ],
    count: 2,
    huduCompanyId: '101',
    companyUrl: COMPANY_URL,
    fetchedAt: '2026-06-09T00:00:00.000Z',
    fromCache: false,
  };
}

async function renderTab() {
  render(<HuduClientPasswordsTab clientId={CLIENT_ID} />);
  await waitFor(() => {
    expect(document.getElementById('hudu-passwords-tab-loading')).toBeNull();
  });
}

async function revealRow(id: number) {
  fireEvent.click(document.getElementById(`hudu-passwords-tab-reveal-${id}`)!);
  await waitFor(() => {
    expect(document.getElementById(`hudu-passwords-tab-value-${id}`)).toBeTruthy();
  });
}

const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  getHuduClientContextMock.mockReset();
  getHuduCompanyPasswordsMock.mockReset();
  revealHuduPasswordMock.mockReset();
  getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: true });
  getHuduCompanyPasswordsMock.mockResolvedValue(okPasswords());
  revealHuduPasswordMock.mockResolvedValue({ state: 'ok', value: SECRET_VALUE });
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  // SECURITY (T082): the value must never reach any console/logger channel.
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_VALUE);
    }
    spy.mockRestore();
  }
  consoleSpies.length = 0;
});

describe('HuduClientPasswordsTab', () => {
  describe('T081: metadata-only password list', () => {
    it('renders rows with name/username and the count badge', async () => {
      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-count')?.textContent).toBe('2');
      expect(document.getElementById('hudu-passwords-tab-name-11')?.textContent).toBe('Domain Admin');
      expect(document.getElementById('hudu-passwords-tab-username-11')?.textContent).toBe(
        'admin@example.com'
      );
      expect(document.getElementById('hudu-passwords-tab-name-12')?.textContent).toBe(
        'Firewall Login'
      );
      // A row without a username renders no username line.
      expect(document.getElementById('hudu-passwords-tab-username-12')).toBeNull();
      expect(getHuduCompanyPasswordsMock).toHaveBeenCalledWith(CLIENT_ID, { refresh: false });
    });

    it('shows no password value anywhere in the DOM before reveal', async () => {
      await renderTab();

      expect(document.body.textContent).not.toContain(SECRET_VALUE);
      expect(document.getElementById('hudu-passwords-tab-value-11')).toBeNull();
      expect(document.getElementById('hudu-passwords-tab-value-12')).toBeNull();
      expect(revealHuduPasswordMock).not.toHaveBeenCalled();
    });

    it('shows the Hudu attribution with a company link out', async () => {
      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-attribution')?.textContent).toContain(
        'Source: Hudu'
      );
      const link = document.getElementById(
        'hudu-passwords-tab-attribution-link'
      ) as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(COMPANY_URL);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    });
  });

  describe('T082: inline Reveal lifecycle', () => {
    it('reveals on click via a live fetch and renders the transient value', async () => {
      await renderTab();

      await revealRow(11);

      expect(revealHuduPasswordMock).toHaveBeenCalledTimes(1);
      expect(revealHuduPasswordMock).toHaveBeenCalledWith(CLIENT_ID, 11);
      expect(document.getElementById('hudu-passwords-tab-value-11')?.textContent).toBe(SECRET_VALUE);
      // Only the revealed row shows a value.
      expect(document.getElementById('hudu-passwords-tab-value-12')).toBeNull();
    });

    it('Hide clears the value from the DOM (back to the Reveal affordance)', async () => {
      await renderTab();
      await revealRow(11);

      fireEvent.click(document.getElementById('hudu-passwords-tab-hide-11')!);

      await waitFor(() => {
        expect(document.getElementById('hudu-passwords-tab-value-11')).toBeNull();
      });
      expect(document.body.textContent).not.toContain(SECRET_VALUE);
      expect(document.getElementById('hudu-passwords-tab-reveal-11')).toBeTruthy();
    });

    it('Refresh clears any revealed value and re-fetches with refresh: true', async () => {
      await renderTab();
      await revealRow(11);

      fireEvent.click(document.getElementById('hudu-passwords-tab-refresh')!);

      await waitFor(() => {
        expect(getHuduCompanyPasswordsMock).toHaveBeenCalledWith(CLIENT_ID, { refresh: true });
      });
      await waitFor(() => {
        expect(document.getElementById('hudu-passwords-tab-value-11')).toBeNull();
      });
      expect(document.body.textContent).not.toContain(SECRET_VALUE);
    });

    it('Copy writes the revealed value to the clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      await renderTab();
      await revealRow(11);

      fireEvent.click(document.getElementById('hudu-passwords-tab-copy-11')!);

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(SECRET_VALUE);
    });

    it('links out to the record in Hudu when a deep-link exists', async () => {
      await renderTab();

      const link = document.getElementById('hudu-passwords-tab-open-11') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('https://docs.example.com/passwords/11');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.textContent).toContain('Open in Hudu');
      // A record without a deep-link renders no per-row link.
      expect(document.getElementById('hudu-passwords-tab-open-12')).toBeNull();
    });

    it('shows an inline per-row message when reveal is denied (403)', async () => {
      revealHuduPasswordMock.mockResolvedValue({ state: 'no_password_access' });

      await renderTab();
      fireEvent.click(document.getElementById('hudu-passwords-tab-reveal-11')!);

      await waitFor(() => {
        expect(
          document.getElementById('hudu-passwords-tab-reveal-error-11')?.textContent
        ).toContain('does not have password access');
      });
      expect(document.getElementById('hudu-passwords-tab-value-11')).toBeNull();
    });

    it('shows inline per-row messages for not_found and unreachable reveals', async () => {
      revealHuduPasswordMock.mockResolvedValueOnce({ state: 'not_found' });
      revealHuduPasswordMock.mockResolvedValueOnce({
        state: 'error',
        error: 'HTTP 503',
        errorKind: 'server_error',
      });

      await renderTab();

      fireEvent.click(document.getElementById('hudu-passwords-tab-reveal-11')!);
      await waitFor(() => {
        expect(
          document.getElementById('hudu-passwords-tab-reveal-error-11')?.textContent
        ).toContain('could not be found');
      });

      fireEvent.click(document.getElementById('hudu-passwords-tab-reveal-12')!);
      await waitFor(() => {
        expect(
          document.getElementById('hudu-passwords-tab-reveal-error-12')?.textContent
        ).toContain('could not be revealed');
      });
      expect(document.body.textContent).not.toContain(SECRET_VALUE);
    });
  });

  describe('T083: empty/error states', () => {
    it('shows the empty state for an ok-but-empty list', async () => {
      getHuduCompanyPasswordsMock.mockResolvedValue({ ...okPasswords(), items: [], count: 0 });

      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-empty')?.textContent).toBe(
        'No Hudu passwords for this company.'
      );
      expect(document.getElementById('hudu-passwords-tab-count')?.textContent).toBe('0');
    });

    it('shows the not-connected state and fetches nothing when Hudu is not connected', async () => {
      getHuduClientContextMock.mockResolvedValue({ connected: false, mapped: false });

      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-not-connected')?.textContent).toContain(
        'Hudu is not connected'
      );
      expect(document.getElementById('hudu-passwords-tab-list')).toBeNull();
      expect(getHuduCompanyPasswordsMock).not.toHaveBeenCalled();
    });

    it('shows the unmapped state and fetches nothing when the client is not mapped', async () => {
      getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: false });

      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-unmapped')?.textContent).toContain(
        'not mapped to a Hudu company'
      );
      expect(getHuduCompanyPasswordsMock).not.toHaveBeenCalled();
    });

    it('renders the unmapped state for a mid-session unmap (fetch-level unmapped)', async () => {
      getHuduCompanyPasswordsMock.mockResolvedValue({ state: 'unmapped' });

      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-unmapped')).toBeTruthy();
      expect(document.getElementById('hudu-passwords-tab-list')).toBeNull();
    });

    it('shows a clear message when the API key lacks password access', async () => {
      getHuduCompanyPasswordsMock.mockResolvedValue({ state: 'no_password_access' });

      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-no-access')?.textContent).toContain(
        'does not have password access enabled'
      );
      expect(document.getElementById('hudu-passwords-tab-list')).toBeNull();
    });

    it('shows the unreachable state when the list fetch errors', async () => {
      getHuduCompanyPasswordsMock.mockResolvedValue({
        state: 'error',
        error: 'HTTP 503',
        errorKind: 'server_error',
      });

      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-list-error')?.textContent).toContain(
        'Hudu could not be reached'
      );
      expect(document.getElementById('hudu-passwords-tab-list')).toBeNull();
    });

    it('shows the tab-level unreachable state when the gating probe throws', async () => {
      getHuduClientContextMock.mockRejectedValue(new Error('network down'));

      await renderTab();

      expect(document.getElementById('hudu-passwords-tab-error')?.textContent).toContain(
        'Hudu could not be reached'
      );
      expect(document.getElementById('hudu-passwords-tab-list')).toBeNull();
      expect(getHuduCompanyPasswordsMock).not.toHaveBeenCalled();
    });
  });

  describe('refresh button', () => {
    it('re-probes the context on Refresh', async () => {
      await renderTab();
      expect(getHuduClientContextMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(getHuduClientContextMock).toHaveBeenCalledTimes(2);
      });
      expect(getHuduCompanyPasswordsMock).toHaveBeenCalledWith(CLIENT_ID, { refresh: true });
    });
  });
});
