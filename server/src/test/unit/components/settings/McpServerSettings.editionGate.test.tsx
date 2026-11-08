/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpServerSettings from '@/components/settings/mcp/McpServerSettings';
import { createEditionGateResponseBody } from '@/lib/editionGating/types';

vi.mock('@/context/TierContext', () => ({
  useTier: () => ({ hasFeature: () => false, isLoading: false }),
}));
vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({ hasFeature: () => false, isLoading: false }),
}));

describe('McpServerSettings edition gate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the shared Pro upgrade notice for EE_REQUIRED', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(createEditionGateResponseBody('mcp')), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<McpServerSettings />);

    expect(await screen.findByRole('heading', { name: 'MCP server requires Pro' })).toBeInTheDocument();
    expect(screen.getByText('MCP server is available with AlgaPSA Pro.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Plans' })).toHaveAttribute(
      'href',
      'https://www.nineminds.com/plans',
    );
  });

  it('keeps a genuine 404 on the ordinary error path', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<McpServerSettings />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load MCP settings.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: /requires Pro/ })).not.toBeInTheDocument();
  });

  it('keeps existing agents visible below Pro and offers cleanup without reactivation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input);
      const payload = path.includes('/idp-providers') && !path.includes('suggestions')
        ? { data: [] }
        : path.includes('/agents')
          ? { data: [{ agent_id: 'agent-key', name: 'Existing support agent', idp_issuer: 'https://login.microsoftonline.com/tenant/v2.0', idp_subject: 'external-subject', active: false }] }
          : path.includes('/roles')
            ? { data: [] }
            : { data: [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    render(<McpServerSettings />);
    expect(await screen.findByText('Existing support agent')).toBeInTheDocument();
    expect(screen.getByText('Add a provider in step 1 first. Then add agents that sign in through it.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open agent actions' }));
    expect(await screen.findByText('View activity')).toBeInTheDocument();
    expect(screen.getByText('Remove…')).toBeInTheDocument();
    expect(screen.queryByText('Reactivate')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

  });
});
