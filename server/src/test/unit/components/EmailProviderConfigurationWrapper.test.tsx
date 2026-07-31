/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';

// Mock the EmailProviderConfiguration component the wrapper renders. The
// wrapper imports it relatively, so mock the resolved package path.
vi.mock('@alga-psa/integrations/components/email/EmailProviderConfiguration', () => ({
  EmailProviderConfiguration: vi.fn(() => {
    return React.createElement(
      'div',
      {
        'data-testid': 'email-provider-config',
      },
      'Email Provider Configuration'
    );
  }),
}));

// The wrapper is exported from the email subbarrel (the top-level components
// barrel re-exports EmailProviderConfiguration but not the wrapper).
import { EmailProviderConfigurationWrapper } from '@alga-psa/integrations/components/email/EmailProviderConfigurationWrapper';

describe('EmailProviderConfigurationWrapper', () => {
  it('should render EmailProviderConfiguration component', () => {
    render(<EmailProviderConfigurationWrapper />);

    expect(screen.getByTestId('email-provider-config')).toBeInTheDocument();
    expect(screen.getByText('Email Provider Configuration')).toBeInTheDocument();
  });
});
