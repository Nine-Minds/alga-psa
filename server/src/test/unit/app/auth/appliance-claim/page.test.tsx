/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApplianceClaimPage from '../../../../../app/auth/appliance-claim/page';

const pushMock = vi.fn();
const signInMock = vi.fn();
const verifyTokenMock = vi.fn();
const completeClaimMock = vi.fn();
let searchToken = 'valid-token';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'token' ? searchToken : null),
  }),
}));

vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

vi.mock('@alga-psa/auth/actions', () => ({
  verifyApplianceClaimTokenAction: (...args: unknown[]) => verifyTokenMock(...args),
  completeApplianceClaimAction: (...args: unknown[]) => completeClaimMock(...args),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function getNamedInput(name: string): HTMLInputElement {
  const element = document.querySelector(`input[name="${name}"]`);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected input[name="${name}"] to exist`);
  }
  return element;
}

describe('ApplianceClaimPage', () => {
  beforeEach(() => {
    searchToken = 'valid-token';
    pushMock.mockReset();
    signInMock.mockReset();
    verifyTokenMock.mockReset();
    completeClaimMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('T007: renders first-admin claim form for valid token', async () => {
    verifyTokenMock.mockResolvedValue({ success: true, status: 'valid' });

    render(<ApplianceClaimPage />);

    await waitFor(() => {
      expect(screen.getByText('Claim Appliance MSP Admin')).toBeInTheDocument();
    });

    expect(getNamedInput('fullName')).toBeInTheDocument();
    expect(getNamedInput('email')).toBeInTheDocument();
    expect(getNamedInput('organizationName')).toBeInTheDocument();
    expect(getNamedInput('password')).toBeInTheDocument();
    expect(getNamedInput('confirmPassword')).toBeInTheDocument();
  });

  it('T007: renders terminal invalid-state UI when token is invalid', async () => {
    verifyTokenMock.mockResolvedValue({ success: false, status: 'invalid_token' });

    render(<ApplianceClaimPage />);

    await waitFor(() => {
      expect(screen.getByText('Invalid claim token')).toBeInTheDocument();
    });

    expect(screen.getByText('Go to MSP Sign In')).toBeInTheDocument();
    expect(screen.queryByText('Claim Appliance MSP Admin')).not.toBeInTheDocument();
  });

  it('T008: signs in and redirects to /msp/onboarding after successful claim', async () => {
    verifyTokenMock.mockResolvedValue({ success: true, status: 'valid' });
    completeClaimMock.mockResolvedValue({
      success: true,
      status: 'valid',
      username: 'admin@example.com',
    });
    signInMock.mockResolvedValue({ ok: true });

    render(<ApplianceClaimPage />);

    await waitFor(() => {
      expect(screen.getByText('Claim Appliance MSP Admin')).toBeInTheDocument();
    });

    fireEvent.change(getNamedInput('fullName'), { target: { value: 'Alice Admin' } });
    fireEvent.change(getNamedInput('email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(getNamedInput('organizationName'), { target: { value: 'Acme MSP' } });
    fireEvent.change(getNamedInput('password'), { target: { value: 'StrongPassword1!' } });
    fireEvent.change(getNamedInput('confirmPassword'), { target: { value: 'StrongPassword1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim appliance' }));

    await waitFor(() => {
      expect(completeClaimMock).toHaveBeenCalledTimes(1);
      expect(signInMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith('/msp/onboarding');
    });
  });
});
