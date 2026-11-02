/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RequestServiceDetailPage from './page';

const getRequestServiceDefinitionDetailAction = vi.fn();
const submitRequestServiceDefinitionAction = vi.fn();
const getRequestServiceVisibilityContextAction = vi.fn();
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
  getRequestServiceVisibilityContextAction: (...args: unknown[]) =>
    getRequestServiceVisibilityContextAction(...args),
  submitRequestServiceDefinitionAction: (...args: unknown[]) =>
    submitRequestServiceDefinitionAction(...args),
}));

const vpnReason = () => document.getElementById('request-service-field-vpn_reason');

describe('RequestServiceDetailPage', () => {
  beforeEach(() => {
    getRequestServiceDefinitionDetailAction.mockReset();
    submitRequestServiceDefinitionAction.mockReset();
    getRequestServiceVisibilityContextAction.mockReset();
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

  const conditionalDetail = (overrides: Record<string, unknown> = {}) => ({
    definitionId: 'definition-1',
    versionId: 'version-1',
    versionNumber: 1,
    title: 'Conditional Request',
    description: null,
    icon: null,
    formSchema: {
      fields: [
        { key: 'needs_vpn', type: 'checkbox', label: 'Needs VPN' },
        { key: 'vpn_reason', type: 'short-text', label: 'VPN Reason' },
      ],
    },
    initialValues: { needs_vpn: false },
    // Load-time keys exclude vpn_reason; the page must not use them as a render filter.
    visibleFieldKeys: ['needs_vpn'],
    executionProvider: 'ticket-only',
    executionConfig: {},
    formBehaviorProvider: 'advanced',
    formBehaviorConfig: {
      visibilityRules: [{ fieldKey: 'vpn_reason', source: 'needs_vpn', operator: 'is-true' }],
    },
    ...overrides,
  });

  it('passes every field plus rules and a session-derived context (no tenant) when advanced rules exist', async () => {
    getRequestServiceDefinitionDetailAction.mockResolvedValue(conditionalDetail());
    getRequestServiceVisibilityContextAction.mockResolvedValue({
      requesterUserId: 'user-1',
      clientId: 'client-1',
      contactId: 'contact-1',
    });

    const element = await RequestServiceDetailPage({
      params: Promise.resolve({ definitionId: 'definition-1' }),
    });
    const markup = renderToStaticMarkup(element);
    // vpn_reason is hidden by default on first paint (checkbox unchecked) but the form
    // received all fields; checking the box reveals it live.
    expect(markup).toContain('request-service-field-needs_vpn');
    expect(markup).not.toContain('request-service-field-vpn_reason');

    render(element);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Needs VPN' }));
    expect(vpnReason()).not.toBeNull();
    expect(markup).not.toContain('tenant');
  });

  it('does not enable visibility or fetch a context for non-advanced providers', async () => {
    getRequestServiceDefinitionDetailAction.mockResolvedValue(
      conditionalDetail({
        formBehaviorProvider: 'basic',
        formBehaviorConfig: {},
        visibleFieldKeys: ['needs_vpn', 'vpn_reason'],
      })
    );

    render(
      await RequestServiceDetailPage({
        params: Promise.resolve({ definitionId: 'definition-1' }),
      })
    );

    expect(getRequestServiceVisibilityContextAction).not.toHaveBeenCalled();
    expect(vpnReason()).not.toBeNull();
  });
});
