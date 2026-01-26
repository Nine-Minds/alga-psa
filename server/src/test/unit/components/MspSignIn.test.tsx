/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

const useSearchParamsMock = vi.fn();
const loginFormMock = vi.fn(() => null);

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../../../../../packages/auth/src/components/MspLoginForm', () => ({
  __esModule: true,
  default: loginFormMock,
}));

vi.mock('../../../../../packages/auth/src/components/TwoFA', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../../../../../packages/auth/src/components/Alert', () => ({
  __esModule: true,
  default: () => null,
}));

const { MspSignIn } = await import('@alga-psa/auth');

describe('MspSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults callbackUrl to the MSP dashboard when none is provided', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams());

    render(<MspSignIn />);

    expect(loginFormMock).toHaveBeenCalled();
    const props = loginFormMock.mock.calls.at(-1)?.[0] as { callbackUrl: string } | undefined;
    expect(props?.callbackUrl).toBe('/msp/dashboard');
  });

  it('passes through an existing callbackUrl parameter', () => {
    const params = new URLSearchParams();
    params.set('callbackUrl', '/msp/tickets');
    useSearchParamsMock.mockReturnValue(params);

    render(<MspSignIn />);

    const props = loginFormMock.mock.calls.at(-1)?.[0] as { callbackUrl: string } | undefined;
    expect(props?.callbackUrl).toBe('/msp/tickets');
  });
});
