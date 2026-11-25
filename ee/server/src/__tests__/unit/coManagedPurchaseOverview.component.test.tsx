// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@alga-psa/ui/lib/i18n/client';
import { getNamespacesForRoute } from '@alga-psa/core/i18n/config';
import { DateFormatProvider } from '@alga-psa/ui/lib/dateFormat/useDateFormat';
import enCommon from '../../../../../server/public/locales/en/common.json';
import enLicensing from '../../../../../server/public/locales/en/msp/licensing.json';
import frCommon from '../../../../../server/public/locales/fr/common.json';
import frLicensing from '../../../../../server/public/locales/fr/msp/licensing.json';

const mocks = vi.hoisted(() => ({ offer: vi.fn(), reviewSeat: vi.fn(), useSeat: vi.fn(), refresh: vi.fn(), discovery: vi.fn(), editorProps: [] as unknown[],
  hasRecovery: vi.fn(), cancelConversion: vi.fn(), cancelTrial: vi.fn(), readers: { billing: vi.fn(), overview: vi.fn(), admit: vi.fn(), allocate: vi.fn() } }));
// The offer is read by the shared hook, which reaches the action through the edition alias.
vi.mock('@enterprise/lib/actions/coManagedSeatTrialActions', () => ({ getSeatTrialOfferAction: mocks.offer }));
vi.mock('../../lib/actions/coManagedSeatTrialActions', () => ({
  reviewSeatTrialConversionAction: mocks.reviewSeat, applyPaidSeatToTrialAction: mocks.useSeat,
  cancelSeatTrialConversionAction: mocks.cancelConversion, cancelCoManagedSeatTrialAction: mocks.cancelTrial,
}));
vi.mock('@/components/co-managed/CoManagedSeatContactField', () => ({ default: () => null }));
vi.mock('next/navigation', () => {
  const router = { refresh: mocks.refresh };
  return { useRouter: () => router };
});
vi.mock('i18next-http-backend', () => ({
  default: { type: 'backend', init() {}, read(_locale: string, _ns: string, done: (error: null, data: object) => void) { done(null, {}); } },
}));
vi.mock('@enterprise/lib/actions/coManagedSeatTrialRecovery', () => ({ hasSeatTrialRecoveryAction: mocks.hasRecovery }));
// The only data this view may read is the purchase state the editor owns; everything operational fails the test.
vi.mock('@/components/co-managed/CoManagedPoolEditor', () => ({
  default: (props: unknown) => { mocks.editorProps.push(props); return <div id="co-managed-pool-editor">pool</div>; },
}));
vi.mock('@/lib/actions/coManagedActions', () => ({
  getCoManagedBillingState: mocks.readers.billing, getCoManagedClientOverviewAction: mocks.readers.overview,
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({ getCoManagedCombinedOverviewAction: mocks.readers.allocate }));
vi.mock('@/lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: mocks.readers.admit }));
vi.mock('../../lib/actions/coManagedPurchaseDiscoveryActions', () => ({ getCoManagedPurchaseDiscoveryAction: mocks.discovery }));

import CoManagedSeatTrialCard from '../../components/co-managed/CoManagedSeatTrial';
import { useSeatTrialOffer } from '@/components/co-managed/useSeatTrialOffer';

// The card is presentational; the hook is the one reader, as on the page.
function CoManagedSeatTrial({ clientId }: { clientId?: string }) {
  const { offer, reload } = useSeatTrialOffer(clientId);
  return <CoManagedSeatTrialCard offer={offer} onReload={reload} clientId={clientId} />;
}
import CoManagedPurchaseOverview from '../../components/co-managed/CoManagedPurchaseOverview';
import { useCoManagedPurchaseNavigation } from '../../components/co-managed/useCoManagedPurchaseNavigation';
import { CO_MANAGED_ACCESS_CHANGED } from '@/components/co-managed/accessRefresh';
import SeatTrialReturn from '@/components/co-managed/SeatTrialReturn';

function renderOnMspRoute(node: ReactNode, route: string, locale: 'en' | 'fr' = 'en') {
  const resources = locale === 'fr'
    ? { common: frCommon, 'msp/licensing': frLicensing }
    : { common: enCommon, 'msp/licensing': enLicensing };
  const namespaces = getNamespacesForRoute(route);
  const preloadedResources = Object.fromEntries(namespaces.map(namespace => [
    namespace, resources[namespace as keyof typeof resources] ?? {},
  ]));
  return render(
    <I18nProvider initialLocale={locale} namespaces={namespaces} preloadedResources={preloadedResources}>
      <DateFormatProvider countryCode={locale === 'fr' ? 'FR' : 'US'}>{node}</DateFormatProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.offer.mockReset().mockResolvedValue({ canStart: false, canPurchase: false, pilot: null, price: { unitAmount: 999, currency: 'USD' } });
  mocks.reviewSeat.mockReset(); mocks.cancelTrial.mockReset(); mocks.useSeat.mockReset(); mocks.refresh.mockReset(); mocks.discovery.mockReset().mockResolvedValue(true); mocks.editorProps = []; (Object.values(mocks.readers) as Array<ReturnType<typeof vi.fn>>).forEach((fn) => fn.mockReset()); });
afterEach(cleanup);

describe('purchase-only co-managed overview', () => {
  it('shows the pool and its explanation, and nothing operational', async () => {
    const { container } = renderOnMspRoute(<CoManagedPurchaseOverview />, '/msp/co-managed');
    expect(await screen.findByText(/paid seat costs .*9.99 per month/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(container.querySelector('#co-managed-pool-editor')).not.toBeNull();
    // The first-purchase explainer rides with the pool; a commercial-only actor gets no Clients link.
    expect(mocks.editorProps[0]).toEqual({ showTotals: true, explainer: expect.anything(), clientsHref: undefined });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Co-managed IT lets a client's own IT staff work alongside your team in AlgaPSA/)).toBeInTheDocument();
    expect(screen.getByText(/Each client technician uses one seat from a pool you buy here\./)).toBeInTheDocument();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.textContent).not.toMatch(/archive|SLA|Search clients|Set up co-managed/i);
    for (const reader of Object.values(mocks.readers)) expect(reader).not.toHaveBeenCalled();
  });

  it('shows local cutoffs on a bound client and requires confirmation before taking a spare paid seat', async () => {
    const base = new Date('2026-11-20T06:00:00');
    const deadline = new Date('2026-11-29T18:00:00');
    mocks.offer.mockResolvedValue({ price: { unitAmount: 1149, currency: 'EUR' }, intake: false,
      canStart: false, canPurchase: true, clientId: 'pilot-client', pilot: { trialId: 'pilot', status: 'active',
        deadline: deadline.toISOString(), baseUntil: base.toISOString(), pendingPurchase: null } });
    mocks.reviewSeat.mockResolvedValue({ kind: 'spare' });
    renderOnMspRoute(<CoManagedSeatTrial clientId="pilot-client" />, '/msp/clients/pilot-client');
    expect(await screen.findByText(/Seat trial ends 11\/29\/2026.*\d:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/Current base access ends 11\/20\/2026.*\d:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/paid seat costs .*11\.49 per month/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Keep this seat'));
    const confirm = await screen.findByText('Confirm use of one paid seat');
    expect(mocks.useSeat).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.useSeat).toHaveBeenCalledWith('pilot'));
  });

  it('shows the French trial terms, status and recovery action on a client record', async () => {
    const deadline = new Date('2026-11-29T18:00:00');
    mocks.offer.mockResolvedValue({ price: { unitAmount: 1149, currency: 'EUR' }, intake: false,
      canStart: false, canPurchase: true, clientId: 'pilot-client', pilot: { trialId: 'pilot', status: 'base_paused',
        deadline: deadline.toISOString(), baseUntil: null, pendingPurchase: { operationId: 'purchase', quantity: 1 }, conversionFailed: true } });
    mocks.cancelConversion.mockRejectedValueOnce(new Error('Cancellation unavailable'));
    renderOnMspRoute(<CoManagedSeatTrial clientId="pilot-client" />, '/msp/clients/pilot-client', 'fr');

    expect(await screen.findByRole('heading', { name: 'Essai de 15 jours pour un poste cogéré' })).toBeInTheDocument();
    expect(screen.getByText(/Un poste payant coûte 11,49\s€ par mois/)).toBeInTheDocument();
    expect(screen.getByText('Abonnement de base suspendu')).toBeInTheDocument();
    expect(screen.getByText('Achat en attente de vérification')).toBeInTheDocument();
    expect(screen.getByText(/L’essai du poste se termine le 29\/11\/2026.*18:00:00\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprendre l’achat' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rétablir l’accès de base dans Compte' })).toHaveAttribute(
      'href', '/msp/account?seatTrialClient=pilot-client',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annuler le passage à un poste payant' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de terminer cette action. Actualisez l’essai et réessayez.');
    expect(mocks.cancelConversion).toHaveBeenCalledWith('pilot');
  });

  describe('trial refusals', () => {
    const pending = () => mocks.offer.mockResolvedValue({ price: { unitAmount: 1149, currency: 'EUR' }, intake: false, canStart: false,
      canPurchase: false, clientId: 'pilot-client', pilot: { trialId: 'pilot', status: 'pending', invited: true, pendingPurchase: null } });

    it('shows the specific copy for a refusal the server named, not the generic message', async () => {
      pending();
      mocks.cancelTrial.mockResolvedValue({ rejected: true, errorCode: 'TRIAL_CLAIM_UNAVAILABLE' });
      renderOnMspRoute(<CoManagedSeatTrial clientId="pilot-client" />, '/msp/clients/pilot-client');
      fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent('This trial is already in use or was started for another client. Refresh and try again.');
      expect(screen.getByRole('alert')).not.toHaveTextContent('Could not complete this action');
    });

    it('words a sponsor refusal for the trial, and a mapped invitation refusal from the seat copy', async () => {
      pending();
      mocks.cancelTrial.mockResolvedValueOnce({ rejected: true, errorCode: 'SPONSOR_NOT_ELIGIBLE' })
        .mockResolvedValueOnce({ rejected: true, errorCode: 'EMAIL_IN_USE' });
      renderOnMspRoute(<CoManagedSeatTrial clientId="pilot-client" />, '/msp/clients/pilot-client');
      fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent('not eligible for a Seat trial');
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already belongs to a user account'));
    });

    it('keeps the generic message for an error nobody named', async () => {
      pending();
      mocks.cancelTrial.mockRejectedValue(new Error('redacted'));
      renderOnMspRoute(<CoManagedSeatTrial clientId="pilot-client" />, '/msp/clients/pilot-client');
      fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not complete this action. Refresh the trial and try again.');
    });
  });

  it('re-renders the server root when verified capacity moves (access is re-derived, not inferred)', () => {
    render(<CoManagedPurchaseOverview />);
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event(CO_MANAGED_ACCESS_CHANGED)); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

it('shows and clears the authorized return link on the French Account page', async () => {
  const storageKey = 'co-managed-seat-trial-return';
  sessionStorage.setItem(storageKey, 'pilot-client');
  mocks.hasRecovery.mockResolvedValue(true);
  try {
    renderOnMspRoute(<SeatTrialReturn />, '/msp/account', 'fr');

    const link = await screen.findByRole('link', { name: 'Revenir à l’essai du poste client' });
    expect(mocks.hasRecovery).toHaveBeenCalledWith('pilot-client');
    expect(link).toHaveAttribute('href', '/msp/clients/pilot-client?tab=co-managed');
    link.addEventListener('click', event => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  } finally {
    sessionStorage.removeItem(storageKey);
  }
});

function Probe({ onValue }: { onValue: (value: unknown) => void }) { onValue(useCoManagedPurchaseNavigation()); return null; }

describe('navigation contribution', () => {
  it('contributes the overview root only, with no permission requirement and no archive row', async () => {
    let value: any = null;
    render(<Probe onValue={(v) => { value = v; }} />);
    await waitFor(() => expect(value).not.toBeNull());
    expect(value.items.map((item: any) => item.href)).toEqual(['/msp/co-managed']);
    expect(value.items[0].requiredPermission).toBeUndefined();
  });

  it('contributes nothing when the server says no, and an error never opens it', async () => {
    mocks.discovery.mockResolvedValue(false);
    let value: any = 'unset';
    render(<Probe onValue={(v) => { value = v; }} />);
    await waitFor(() => expect(mocks.discovery).toHaveBeenCalled());
    expect(value).toBeNull();
    mocks.discovery.mockRejectedValue(new Error('boom'));
    act(() => { window.dispatchEvent(new Event(CO_MANAGED_ACCESS_CHANGED)); });
    await waitFor(() => expect(mocks.discovery).toHaveBeenCalledTimes(2));
    expect(value).toBeNull();
  });

  it('an access refresh re-reads the server and never blinks an open entry out while it does', async () => {
    let value: any = null;
    let resolveSecond: (open: boolean) => void = () => undefined;
    render(<Probe onValue={(v) => { value = v; }} />);
    await waitFor(() => expect(value).not.toBeNull());
    mocks.discovery.mockReturnValue(new Promise<boolean>((resolve) => { resolveSecond = resolve; }));
    act(() => { window.dispatchEvent(new Event(CO_MANAGED_ACCESS_CHANGED)); });
    expect(value).not.toBeNull();
    await act(async () => { resolveSecond(true); });
    expect(value).not.toBeNull();
  });
});
