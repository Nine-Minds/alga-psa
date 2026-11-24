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

  it('saves the mode and a normalized authserv-id list', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true, policy: { mode: 'off', trustedAuthservIds: ['mx.avanan.net'] } });
    render(<TrustedGatewaySettings provider={{ id: 'p1', inboundAuthTrust: { mode: 'arc-sealed', trustedAuthservIds: [] } }} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText('mx.example.net'), { target: { value: 'MX.Avanan.net, ' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ mode: 'arc-sealed', trustedAuthservIds: ['mx.avanan.net'] }));
  });
});
