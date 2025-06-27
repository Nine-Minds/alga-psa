/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { EmailProviderConfigurationWrapper } from '../../../components/EmailProviderConfigurationWrapper';

// Mock the EmailProviderConfiguration component
vi.mock('../../../components/EmailProviderConfiguration', () => ({
  EmailProviderConfiguration: () => (
    <div data-testid="email-provider-config">
      Email Provider Configuration
    </div>
  ),
}));

describe('EmailProviderConfigurationWrapper', () => {
  it('should render EmailProviderConfiguration component', () => {
    render(<EmailProviderConfigurationWrapper />);

    expect(screen.getByTestId('email-provider-config')).toBeInTheDocument();
    expect(screen.getByText('Email Provider Configuration')).toBeInTheDocument();
  });
});