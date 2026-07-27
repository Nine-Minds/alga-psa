/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

describe('EntraIntegrationPage dynamic import target', () => {
  it('loads and renders the enterprise Entra page shell component', async () => {
    const module = await import('@enterprise/components/settings/integrations/entra/EntraIntegrationPage');
    const EntraIntegrationPage = module.default;

    render(<EntraIntegrationPage />);

    expect(screen.getByText('Enterprise Feature')).toBeInTheDocument();
    expect(
      screen.getByText('Microsoft Entra integration is available in the Enterprise edition of Alga PSA.')
    ).toBeInTheDocument();
  });
});
