// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { CustodyCard } from '@alga-psa/assets/components/custody/CustodyCard';

const state = vi.hoisted(() => ({ denied: false }));
vi.mock('@alga-psa/assets/actions/assetCustodyActions', () => ({
  getAssetCustody: async () =>
    state.denied
      ? { success: false, error: { message: 'Not found' } }
      : { success: true, data: { open: null, episodes: [{ custody_id: 'episode', closed_at: '2026-10-28' }] } },
  listCustodyEvents: async () => ({
    success: true,
    data: [
      {
        event_id: 'intake',
        custody_id: 'episode',
        event_type: 'received',
        occurred_at: '2026-10-27T10:00:00Z',
        document_ids: ['front', 'back'],
      },
      {
        event_id: 'move',
        custody_id: 'episode',
        event_type: 'moved',
        occurred_at: '2026-10-28T10:00:00Z',
        document_ids: ['shelf'],
      },
      {
        event_id: 'return',
        custody_id: 'episode',
        event_type: 'returned',
        occurred_at: '2026-10-28T12:00:00Z',
        document_ids: [],
      },
    ],
  }),
}));
vi.mock('@alga-psa/assets/context/AssetCrossFeatureContext', () => ({
  useAssetCrossFeature: () => ({
    renderCustodyPhotos: (ids: string[], event: string) => <div data-testid={`photos-${event}`}>{ids.join(',')}</div>,
  }),
}));
vi.mock('@alga-psa/assets/components/custody/custodyClient', () => ({
  custodyOutcome: (result: any) =>
    result.success ? { ok: true, data: result.data } : { ok: false, message: result.error.message },
  useCustodyLocations: () => ({ canUpdate: false }),
}));
vi.mock('@alga-psa/assets/components/custody/CustodyFields', () => ({
  usePartyLabels: () => [],
  usePurposeOptions: () => [],
}));
vi.mock('@alga-psa/assets/components/custody/CustodyDialogs', () => ({
  CustodyStepDialog: () => null,
  OpenCustodyDialog: () => null,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options: any = {}) => options.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('@alga-psa/core', () => ({
  formatCalendarDate: (date: string) => date,
  getCurrentDateInUserTimeZone: () => '2026-10-28',
}));
vi.mock('@alga-psa/ui/components/bento', () => ({
  BentoTile: ({ children }: any) => <section>{children}</section>,
  BentoTileEmpty: ({ children }: any) => <div>{children}</div>,
}));

afterEach(() => {
  cleanup();
  state.denied = false;
});
function card() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CustodyCard id="custody" assetId="asset" />
    </SWRConfig>
  );
}

describe('custody photo history', () => {
  it('keeps each thumbnail strip on its matching event and omits empty strips', async () => {
    card();
    fireEvent.click(await screen.findByRole('button', { name: /Custody history/ }));
    const intake = await screen.findByTestId('photos-intake');
    const move = screen.getByTestId('photos-move');
    expect(within(intake.closest('li')!).getByText('front,back')).toBeTruthy();
    expect(within(move.closest('li')!).getByText('shelf')).toBeTruthy();
    expect(intake.closest('li')).not.toBe(move.closest('li'));
    expect(screen.queryByTestId('photos-return')).toBeNull();
  });

  it('renders no card or photo metadata when asset access is refused', async () => {
    state.denied = true;
    const { container } = card();
    // Resolve both the SWR fetch and its render without relying on a timer.
    const { act } = await import('@testing-library/react');
    await act(async () => {});
    expect(container.innerHTML).toBe('');
  });
});
