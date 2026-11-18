// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  HandOffCustodyDialog,
  MoveCustodyDialog,
  ReturnCustodyDialog,
  ShipCustodyDialog,
} from '@alga-psa/assets/components/custody/CustodyDialogs';

const actions = vi.hoisted(() => ({ upload: vi.fn(), fallback: vi.fn() }));
vi.mock('@alga-psa/assets/context/AssetCrossFeatureContext', () => ({
  useAssetCrossFeature: () => ({ recordCustodyEventWithPhotos: actions.upload }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options: any = {}) => options.defaultValue ?? key }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (props: any) => <label {...props} /> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: (props: any) => <textarea {...props} /> }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  default: ({ id, value, onValueChange }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="" />
      <option value="colleague">Colleague</option>
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) =>
    isOpen ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/assets/actions/assetCustodyActions', () => ({
  moveCustody: actions.fallback,
  handOffCustody: actions.fallback,
  shipCustody: actions.fallback,
  returnCustodyToClient: actions.fallback,
}));
vi.mock('@alga-psa/assets/components/custody/custodyClient', () => ({
  custodyOutcome: (result: any) =>
    result.success ? { ok: true, data: result.data } : { ok: false, message: result.error.message },
  useCustodyLocations: () => ({ locations: [] }),
  useCustodyUsers: () => [],
}));
vi.mock('@alga-psa/assets/components/custody/CustodyFields', () => ({
  CUSTODY_NOTE_MAX: 2000,
  CustodyPlaceFields: ({ idPrefix, locationId, onLocationChange, locationLabel }: any) => (
    <label>
      {locationLabel}
      <select id={`${idPrefix}-location`} value={locationId} onChange={(event) => onLocationChange(event.target.value)}>
        <option value="office">Office</option>
        <option value="annex">Annex</option>
      </select>
    </label>
  ),
  CustodyDetailFields: () => null,
  cleanAccessories: () => [],
  emptyCustodyDetails: () => ({}),
}));

afterEach(cleanup);
beforeEach(() => {
  actions.upload.mockReset().mockResolvedValue({ success: true, data: {} });
  actions.fallback.mockReset().mockResolvedValue({ success: true, data: {} });
});
const custody = { custody_id: 'episode', location_id: 'office', bin: null } as any;
const cases = [
  {
    Component: MoveCustodyDialog,
    type: 'moved',
    submit: 'Move',
    prepare: () => fireEvent.change(screen.getByLabelText('Move to'), { target: { value: 'annex' } }),
  },
  {
    Component: HandOffCustodyDialog,
    type: 'handed_off',
    submit: 'Hand off',
    prepare: () => fireEvent.change(screen.getByLabelText('New holder'), { target: { value: 'colleague' } }),
  },
  {
    Component: ShipCustodyDialog,
    type: 'shipped',
    submit: 'Ship',
    prepare: () => fireEvent.change(screen.getByLabelText('Vendor or carrier'), { target: { value: 'Depot' } }),
  },
  { Component: ReturnCustodyDialog, type: 'returned', submit: 'Return to client', prepare: () => {} },
];

describe('custody step photo submission', () => {
  it.each(cases)(
    'submits photos with the $type event and closes only on success',
    async ({ Component, type, submit, prepare }) => {
      const onClose = vi.fn();
      render(<Component isOpen custody={custody} onClose={onClose} onDone={() => {}} />);
      prepare();
      fireEvent.change(screen.getByLabelText('Photos (optional)'), {
        target: { files: [new File(['photo'], 'condition.png', { type: 'image/png' })] },
      });
      fireEvent.click(screen.getByRole('button', { name: submit }));
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(actions.upload).toHaveBeenCalledWith(
        'episode',
        expect.objectContaining({ event_type: type }),
        expect.any(FormData)
      );
      expect(actions.upload.mock.calls[0][2].getAll('photos')).toHaveLength(1);
      expect(actions.fallback).not.toHaveBeenCalled();
    }
  );

  it('keeps a refused step open with its selected photo and explains the failure', async () => {
    actions.upload.mockResolvedValue({ success: false, error: { message: 'Item is no longer in custody' } });
    const onClose = vi.fn();
    render(<ReturnCustodyDialog isOpen custody={custody} onClose={onClose} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('Photos (optional)'), {
      target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Return to client' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Item is no longer in custody');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('prevents an oversized photo request and permits submission after correcting the selection', () => {
    render(<ReturnCustodyDialog isOpen custody={custody} onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('Photos (optional)'), {
      target: { files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png')] },
    });
    expect((screen.getByRole('button', { name: 'Return to client' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('10 MB');
    fireEvent.change(screen.getByLabelText('Photos (optional)'), { target: { files: [] } });
    expect((screen.getByRole('button', { name: 'Return to client' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
