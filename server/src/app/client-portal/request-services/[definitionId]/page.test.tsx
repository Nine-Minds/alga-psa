/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
});
