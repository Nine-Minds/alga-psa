/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

describe('EntraIntegrationSettings dynamic import target', () => {
  it('loads and renders the enterprise Entra settings shell component', async () => {
    const module = await import('@enterprise/components/settings/integrations/EntraIntegrationSettings');
    const EntraIntegrationSettings = module.default;

    render(<EntraIntegrationSettings />);

    expect(screen.getByText('Enterprise Feature')).toBeInTheDocument();
    expect(
      screen.getByText('Microsoft Entra integration is available in the Enterprise edition of Alga PSA.')
    ).toBeInTheDocument();
  });
});
