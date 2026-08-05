/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpServerSettings from '@/components/settings/mcp/McpServerSettings';
import { createEditionGateResponseBody } from '@/lib/editionGating/types';

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
});
