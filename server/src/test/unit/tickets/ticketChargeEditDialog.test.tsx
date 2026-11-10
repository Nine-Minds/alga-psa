// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketChargeEditDialog from '@alga-psa/tickets/components/ticket/TicketChargeEditDialog';
import type { Dialog } from '@alga-psa/ui/components/Dialog';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, footer }: React.ComponentProps<typeof Dialog>) => <div>{children}{footer}</div>,
  DialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: { id: string }) => ({ automationIdProps: { id }, updateMetadata: vi.fn() }),
}));
afterEach(cleanup);

describe('serialized charge editing', () => {
  it('locks all quantity controls but still saves description changes', async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<TicketChargeEditDialog id="edit-material" quantity={1} description="Old" quantityLocked
      onSave={onSave} onClose={onClose} />);
    expect(document.getElementById('edit-material-decrease-button')).toBeDisabled();
    expect(document.getElementById('edit-material-increase-button')).toBeDisabled();
    expect(document.getElementById('edit-material-quantity-input')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('fixedFeeServices.description'), { target: { value: 'New' } });
    fireEvent.click(screen.getByText('chargeEdit.save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ quantity: 1, description: 'New' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('keeps quantity editable for services and nonserialized materials', () => {
    render(<TicketChargeEditDialog id="edit-service" quantity={1} description=""
      onSave={vi.fn()} onClose={vi.fn()} />);
    expect(document.getElementById('edit-service-increase-button')).not.toBeDisabled();
    fireEvent.click(document.getElementById('edit-service-increase-button')!);
    expect(screen.getByLabelText('fixedFeeServices.quantity')).toHaveValue(2);
  });
});
