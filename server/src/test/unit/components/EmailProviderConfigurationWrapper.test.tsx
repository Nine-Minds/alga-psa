/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { EmailProviderConfigurationWrapper } from '@alga-psa/integrations/components';

// Mock the EmailProviderConfiguration component with a factory function
vi.mock('../../../components/EmailProviderConfiguration', () => ({
  EmailProviderConfiguration: vi.fn(() => {
    return React.createElement('div', { 
      'data-testid': 'email-provider-config' 
    }, 'Email Provider Configuration');
  }),
}));

describe('EmailProviderConfigurationWrapper', () => {
  it('should render EmailProviderConfiguration component', () => {
    render(<EmailProviderConfigurationWrapper />);

    expect(screen.getByTestId('email-provider-config')).toBeInTheDocument();
    expect(screen.getByText('Email Provider Configuration')).toBeInTheDocument();
  });
});
