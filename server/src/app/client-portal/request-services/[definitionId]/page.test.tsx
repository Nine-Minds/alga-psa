/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RequestServiceDetailPage from './page';

const getRequestServiceDefinitionDetailAction = vi.fn();
const submitRequestServiceDefinitionAction = vi.fn();
const notFound = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

vi.mock('./actions', () => ({
  getRequestServiceDefinitionDetailAction: (...args: unknown[]) =>
    getRequestServiceDefinitionDetailAction(...args),
  submitRequestServiceDefinitionAction: (...args: unknown[]) =>
    submitRequestServiceDefinitionAction(...args),
}));

vi.mock('@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('RequestServiceDetailPage', () => {
  beforeEach(() => {
    getRequestServiceDefinitionDetailAction.mockReset();
    submitRequestServiceDefinitionAction.mockReset();
    notFound.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a linked ticket reference in the successful confirmation state', async () => {
    getRequestServiceDefinitionDetailAction.mockResolvedValue({
      definitionId: 'definition-1',
      versionId: 'version-1',
      versionNumber: 3,
      title: 'Access Request',
      description: 'Request secure access',
      icon: 'shield',
      formSchema: { fields: [] },
      initialValues: {},
      visibleFieldKeys: [],
      executionProvider: 'ticket-only',
      executionConfig: {},
      formBehaviorProvider: 'basic',
      formBehaviorConfig: {},
    });

    render(
      await RequestServiceDetailPage({
        params: Promise.resolve({ definitionId: 'definition-1' }),
        searchParams: Promise.resolve({
          submitted: 'submission-1',
          ticketId: 'ticket-123',
        }),
      })
    );

    const ticketLink = screen.getByRole('link', { name: 'ticket-123' });
    expect(ticketLink).toHaveAttribute('href', '/client-portal/tickets/ticket-123');
    expect(screen.queryByText('shield')).not.toBeInTheDocument();
  });

  it('disables native browser validation so required file uploads flow through the server banner state', async () => {
    getRequestServiceDefinitionDetailAction.mockResolvedValue({
      definitionId: 'definition-1',
      versionId: 'version-1',
      versionNumber: 1,
      title: 'Hardware Request',
      description: 'Attach a quote',
      icon: 'paperclip',
      formSchema: {
        fields: [
          { key: 'device_model', type: 'short-text', label: 'Device Model', required: true },
          { key: 'purchase_quote', type: 'file-upload', label: 'Purchase Quote', required: true },
        ],
      },
      initialValues: {},
      visibleFieldKeys: ['device_model', 'purchase_quote'],
      executionProvider: 'ticket-only',
      executionConfig: {},
      formBehaviorProvider: 'basic',
      formBehaviorConfig: {},
    });

    const element = await RequestServiceDetailPage({
      params: Promise.resolve({ definitionId: 'definition-1' }),
      searchParams: Promise.resolve({
        error: 'Submission validation failed: Required file upload missing for "purchase_quote"',
      }),
    });

    render(element);

    expect(screen.getByText('Unable to submit request')).toBeInTheDocument();
    expect(
      screen.getByText('Submission validation failed: Required file upload missing for "purchase_quote"')
    ).toBeInTheDocument();

    const markup = renderToStaticMarkup(element);
    expect(markup).toContain('noValidate=""');
  });
});
