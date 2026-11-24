/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrustedGatewaySettings } from './TrustedGatewaySettings';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

describe('TrustedGatewaySettings', () => {
  afterEach(cleanup);

  it('states that it only affects contact attribution and never internal users', () => {
    render(<TrustedGatewaySettings provider={{ id: 'p1' }} onSave={vi.fn()} />);
    expect(screen.getByText('Trusted inbound gateway')).toBeInTheDocument();
    expect(screen.getByText(/never applies to internal users/)).toBeInTheDocument();
  });

  it('describes what each mode verifies, and nothing while the mode is off', () => {
    const { unmount } = render(<TrustedGatewaySettings provider={{ id: 'p1' }} onSave={vi.fn()} />);
    expect(screen.queryByText(/ARC seal/)).toBeNull();
    expect(screen.getByText(/Only gateways you list here are trusted\./)).toBeInTheDocument();
    unmount();

    const sealed = render(
      <TrustedGatewaySettings provider={{ id: 'p1', inboundAuthTrust: { mode: 'arc-sealed', trustedAuthservIds: ['mx.avanan.net'] } }} onSave={vi.fn()} />
    );
    expect(screen.getByText(/Alga checks the message's ARC seals itself\./)).toBeInTheDocument();
    expect(screen.queryByText(/Alga does not check the ARC seal itself/)).toBeNull();
    sealed.unmount();

    render(
      <TrustedGatewaySettings provider={{ id: 'p1', inboundAuthTrust: { mode: 'mta-arc-pass', trustedAuthservIds: ['mx.avanan.net'] } }} onSave={vi.fn()} />
    );
    expect(screen.getByText(/Alga does not check the ARC seal itself\. It relies on your receiving mail server reporting arc=pass\./)).toBeInTheDocument();
    expect(screen.queryByText(/Alga checks the message's ARC seals itself/)).toBeNull();
  });

  it('saves the mode and a normalized authserv-id list', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true, policy: { mode: 'off', trustedAuthservIds: ['mx.avanan.net'] } });
    render(<TrustedGatewaySettings provider={{ id: 'p1', inboundAuthTrust: { mode: 'arc-sealed', trustedAuthservIds: [] } }} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText('mx.example.net'), { target: { value: 'MX.Avanan.net, ' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ mode: 'arc-sealed', trustedAuthservIds: ['mx.avanan.net'] }));
  });
});
