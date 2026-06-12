// @vitest-environment jsdom
/**
 * T237, T239 — "Hudu Documentation" section in the client Documents tab
 * (client-docs-section group). jsdom + @testing-library, mirroring
 * huduClientTab.component.test idioms: the articles action, i18n and the
 * Alert primitive are mocked; assertions run against the DOM.
 *
 * T238 note: section visibility reuses the exact `huduClientTab.visible`
 * gate already covered by huduClientTabGate.test; the ClientDetails wiring
 * (render only when visible) is asserted by the source-scan test in
 * packages/clients (ClientDetails.huduDocumentsSection.wiring.test.ts).
 * Here the in-component half of the gate is covered: a fetch-level
 * 'unmapped' renders nothing.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HuduClientDocumentsSection } from '@ee/components/integrations/hudu/HuduClientDocumentsSection';
import type { HuduCompanyDataResult } from '@ee/lib/actions/integrations/huduDataActions';
import type { HuduArticle } from '@ee/lib/integrations/hudu/contracts';

const { getHuduCompanyArticlesMock } = vi.hoisted(() => ({
  getHuduCompanyArticlesMock: vi.fn(),
}));

// Same module as the component's relative import (vitest dedupes by resolved id).
vi.mock('@ee/lib/actions/integrations/huduDataActions', () => ({
  getHuduCompanyArticles: getHuduCompanyArticlesMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const UPDATED_AT = '2026-05-01T12:00:00.000Z';

function okArticles(): HuduCompanyDataResult<HuduArticle> {
  return {
    state: 'ok',
    items: [
      {
        id: 7,
        company_id: 101,
        name: 'Onboarding Runbook',
        folder_id: 3,
        updated_at: UPDATED_AT,
        url: '/kba/7',
        hudu_url: 'https://docs.example.com/kba/7',
      },
      {
        id: 9,
        company_id: 101,
        name: 'Firewall Standards',
        folder_id: null,
        updated_at: null,
        url: null,
        hudu_url: null,
      },
    ],
    count: 2,
    huduCompanyId: '101',
    companyUrl: 'https://docs.example.com/companies/101',
    fetchedAt: '2026-06-11T00:00:00.000Z',
    fromCache: false,
  };
}

async function renderSection() {
  const result = render(<HuduClientDocumentsSection clientId={CLIENT_ID} />);
  await waitFor(() => {
    expect(getHuduCompanyArticlesMock).toHaveBeenCalled();
  });
  return result;
}

function toggle() {
  fireEvent.click(document.getElementById('hudu-client-docs-toggle')!);
}

beforeEach(() => {
  getHuduCompanyArticlesMock.mockReset();
  getHuduCompanyArticlesMock.mockResolvedValue(okArticles());
});

describe('HuduClientDocumentsSection', () => {
  describe('T237: article rows with deep-links for a mapped client', () => {
    it('fetches on mount (cached, no refresh) and shows the count in the collapsed title', async () => {
      await renderSection();

      expect(getHuduCompanyArticlesMock).toHaveBeenCalledWith(CLIENT_ID, { refresh: false });
      expect(document.getElementById('hudu-client-docs-title')?.textContent).toBe(
        'Hudu Documentation'
      );
      await waitFor(() => {
        expect(document.getElementById('hudu-client-docs-count')?.textContent).toBe('(2)');
      });
      // Collapsed by default: no rows in the DOM.
      expect(document.getElementById('hudu-client-doc-7')).toBeNull();
      expect(document.getElementById('hudu-client-docs-toggle')?.getAttribute('aria-expanded')).toBe(
        'false'
      );
    });

    it('expand shows names, formatted dates and new-tab deep-links; collapse hides them', async () => {
      await renderSection();
      await waitFor(() => {
        expect(document.getElementById('hudu-client-docs-count')).toBeTruthy();
      });

      toggle();
      expect(document.getElementById('hudu-client-docs-toggle')?.getAttribute('aria-expanded')).toBe(
        'true'
      );

      const link = document.getElementById('hudu-client-doc-7') as HTMLAnchorElement;
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBe('https://docs.example.com/kba/7');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('rel')).toContain('noreferrer');
      expect(link.textContent).toContain('Onboarding Runbook');

      expect(document.getElementById('hudu-client-doc-7-updated')?.textContent).toBe(
        new Date(UPDATED_AT).toLocaleDateString()
      );

      // A record without a deep-link renders as plain text, not an anchor; no date row.
      const unlinked = document.getElementById('hudu-client-doc-9');
      expect(unlinked?.tagName).toBe('SPAN');
      expect(unlinked?.textContent).toContain('Firewall Standards');
      expect(document.getElementById('hudu-client-doc-9-updated')).toBeNull();

      toggle();
      expect(document.getElementById('hudu-client-doc-7')).toBeNull();
      expect(document.getElementById('hudu-client-docs-toggle')?.getAttribute('aria-expanded')).toBe(
        'false'
      );
    });

    it('shows the empty state for an ok-but-empty list', async () => {
      getHuduCompanyArticlesMock.mockResolvedValue({ ...okArticles(), items: [], count: 0 });

      await renderSection();
      await waitFor(() => {
        expect(document.getElementById('hudu-client-docs-count')?.textContent).toBe('(0)');
      });

      toggle();
      expect(document.getElementById('hudu-client-docs-empty')?.textContent).toBe(
        'No Hudu articles'
      );
      expect(document.querySelector('#hudu-client-docs a')).toBeNull();
    });
  });

  describe('T239: errors stay inside the section', () => {
    it('a typed error result renders the inline alert and no rows, without throwing', async () => {
      getHuduCompanyArticlesMock.mockResolvedValue({
        state: 'error',
        error: 'HTTP 503',
        errorKind: 'server_error',
      });

      await renderSection();
      toggle();

      await waitFor(() => {
        expect(document.getElementById('hudu-client-docs-error')?.textContent).toContain(
          'Hudu could not be reached'
        );
      });
      expect(document.getElementById('hudu-client-docs-count')).toBeNull();
      expect(document.querySelector('#hudu-client-docs li')).toBeNull();
    });

    it('a thrown action error is caught and rendered as the same inline alert', async () => {
      getHuduCompanyArticlesMock.mockRejectedValue(new Error('Forbidden'));

      await renderSection();
      toggle();

      await waitFor(() => {
        expect(document.getElementById('hudu-client-docs-error')).toBeTruthy();
      });
      expect(document.querySelector('#hudu-client-docs li')).toBeNull();
    });

    it("a fetch-level 'unmapped' renders nothing (gate already excludes it upstream)", async () => {
      getHuduCompanyArticlesMock.mockResolvedValue({ state: 'unmapped' });

      const { container } = await renderSection();

      await waitFor(() => {
        expect(document.getElementById('hudu-client-docs')).toBeNull();
      });
      expect(container.innerHTML).toBe('');
    });
  });
});
