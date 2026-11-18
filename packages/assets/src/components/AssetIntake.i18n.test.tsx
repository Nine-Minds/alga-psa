/* @vitest-environment jsdom */
import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssetTagScanLookup } from './AssetTagScanLookup';
import FullAddAssetForm from './FullAddAssetForm';
import LabelFirstAssetIntake from './LabelFirstAssetIntake';
import AssetNumberingSettings from './settings/AssetNumberingSettings';

const h = vi.hoisted(() => ({
  find: vi.fn(), complete: vi.fn(), push: vi.fn(), create: vi.fn(), save: vi.fn(), activate: vi.fn(), toast: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', async () => ({ useTranslation: (await import('react-i18next')).useTranslation }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock('./AssetForm', () => ({ default: ({ createMode }: any) => <div data-testid="asset-form" data-create-mode={createMode} /> }));
vi.mock('@alga-psa/reference-data/components/settings/NumberingSettings', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ toast: { success: h.toast } }));
vi.mock('../actions/assetNumberingActions', () => ({
  findAssetByScannedTag: h.find, completeScannedAssetReservation: h.complete,
  createMinimalAssetForLabelIntake: h.create, updateClientAssetPrefix: h.save, activateAssetTagUniqueness: h.activate,
  listAssetClientPrefixes: vi.fn(async () => [{ client_id: 'c1', client_name: 'Acme', asset_prefix: null }]),
  listAssetTagAudit: vi.fn(async () => [{ audit_id: 'audit1', asset_id: 'a1', asset_tag: '', normalized_tag: 'ABC', reason: 'blank', resolved_at: null }]),
  getAssetSequenceContinuationReview: vi.fn(async () => ({ scannedTags: 12, numericSuffixTags: 8, maximumSuffix: '42', suggestedNextValue: '43', examples: ['OLD-42'] })),
  markAssetTagAuditReviewed: vi.fn(),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: ({ label, id, ...props }: any) => <><label htmlFor={id}>{label}</label><input id={id} {...props} /></> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <div role="alert">{children}</div>, AlertDescription: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children }: any) => isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
  DialogContent: ({ children }: any) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: ({ onSelect }: any) => <button onClick={() => onSelect('c1')}>Acme</button> }));
vi.mock('@alga-psa/ui/components/labels/LabelPrintDialog', () => ({ LabelPrintDialog: ({ isOpen, ids }: any) => isOpen ? <output data-testid="print-asset">{ids.join(',')}</output> : null }));

async function renderLocalized(ui: React.ReactElement, locale = 'fr') {
  const missing = vi.fn();
  const i18n = createInstance();
  const resources = Object.fromEntries(['msp/assets', 'msp/settings', 'common'].map(ns => [ns,
    JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../server/public/locales', locale, `${ns}.json`), 'utf8')),
  ]));
  await i18n.init({ lng: locale, fallbackLng: false, resources: { [locale]: resources }, saveMissing: true,
    missingKeyHandler: missing, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
  return { i18n, missing };
}

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ success: true }); h.activate.mockResolvedValue({ success: true }); });
afterEach(cleanup);

describe('asset intake with shipped translations', () => {
  it('renders the full-intake heading, guidance and back link in French', async () => {
    const { missing } = await renderLocalized(<FullAddAssetForm />);
    expect(screen.getByRole('heading', { name: 'Ajouter un actif' })).toBeTruthy();
    expect(screen.getByText('Choisissez un numéro du locataire ou conservez une étiquette déjà imprimée.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour aux actifs' }).getAttribute('href')).toBe('/msp/assets');
    expect(screen.getByTestId('asset-form').getAttribute('data-create-mode')).toBe('true');
    expect(missing).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'ambiguous' }, 'Plusieurs actifs visibles portent cette étiquette. Demandez à un administrateur de résoudre les doublons.'],
    [{ kind: 'not_found' }, 'Aucun actif visible ne correspond exactement à cette étiquette.'],
    [new Error('Access denied'), 'Impossible de rechercher cette étiquette. Vérifiez vos droits d’accès et réessayez.'],
  ])('shows translated scan outcomes without navigating (%j)', async (outcome, message) => {
    let finish!: (value: any) => void;
    h.find.mockImplementation(() => new Promise((resolve, reject) => { finish = value => value instanceof Error ? reject(value) : resolve(value); }));
    const { missing } = await renderLocalized(<AssetTagScanLookup />);
    const form = screen.getByRole('form', { name: 'Scanner une étiquette d’actif' });
    fireEvent.change(screen.getByLabelText('Scanner ou saisir une étiquette'), { target: { value: 'TAG-42' } });
    fireEvent.submit(form);
    expect((screen.getByRole('button', { name: 'Recherche en cours…' }) as HTMLButtonElement).disabled).toBe(true);
    finish(outcome);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(message));
    expect(h.find).toHaveBeenCalledWith('TAG-42');
    expect(h.push).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Rechercher un actif' }) as HTMLButtonElement).disabled).toBe(false);
    expect(missing).not.toHaveBeenCalled();
  });

  it('completes a scanned reservation and opens its asset', async () => {
    h.find.mockResolvedValue({ kind: 'reservation', reservation: { reservation_id: 'r1' } });
    h.complete.mockResolvedValue({ asset_id: 'a1' });
    const { missing } = await renderLocalized(<AssetTagScanLookup />);
    fireEvent.change(screen.getByLabelText('Scanner ou saisir une étiquette'), { target: { value: 'TAG-42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher un actif' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/msp/assets/a1'));
    expect(h.complete).toHaveBeenCalledWith('r1');
    expect(missing).not.toHaveBeenCalled();
  });

  it.each(['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'])('resolves intake and numbering settings in %s without missing-key fallbacks', async locale => {
    const { i18n, missing } = await renderLocalized(<><LabelFirstAssetIntake /><AssetNumberingSettings /></>, locale);
    const t = i18n.getFixedT(locale, 'msp/settings');
    const ta = i18n.getFixedT(locale, 'msp/assets');
    await screen.findByText(t('assets.numbering.continuationReview', { scanned: 12, numeric: 8, maximum: '42', next: '43' }), { exact: false });
    expect(screen.getByText(t('assets.numbering.continuationExamples', { examples: 'OLD-42' }), { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: t('assets.numbering.blankTag') })).toBeTruthy();
    expect(screen.getByText(t('assets.numbering.normalizedTag', { tag: 'ABC' }), { exact: false })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Acme'), { target: { value: 'AC' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('actions.save', { ns: 'common' }) }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(t('assets.numbering.prefixSaved')));
    expect(h.save).toHaveBeenCalledWith('c1', 'AC');
    fireEvent.click(screen.getByRole('button', { name: t('assets.numbering.activate') }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(t('assets.numbering.uniquenessEnabled')));
    h.create.mockRejectedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: ta('labelFirstIntake.start') }));
    expect(screen.getByRole('dialog', { name: ta('labelFirstIntake.title') })).toBeTruthy();
    expect(screen.getByText(ta('labelFirstIntake.help'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    fireEvent.click(screen.getByRole('button', { name: ta('labelFirstIntake.createPrint') }));
    await screen.findByText(ta('labelFirstIntake.createFailed'));
    h.create.mockResolvedValueOnce({ asset_id: 'new-asset' });
    fireEvent.change(screen.getByLabelText(ta('labelFirstIntake.name')), { target: { value: 'New laptop' } });
    fireEvent.click(screen.getByRole('button', { name: ta('labelFirstIntake.createPrint') }));
    await waitFor(() => expect(screen.getByTestId('print-asset').textContent).toBe('new-asset'));
    expect(h.create).toHaveBeenLastCalledWith('c1', 'New laptop');
    expect(missing).not.toHaveBeenCalled();
  });
});
