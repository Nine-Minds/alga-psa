/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select data-testid={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import McpServerSettings from '@/components/settings/mcp/McpServerSettings';

const MCP_RESOURCE = 'https://psa.example.com/api/mcp';

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('McpServerSettings trusted-IdP audience guidance', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/idp-suggestions')) return json({ data: { mcpResource: MCP_RESOURCE } });
      if (url.includes('/audit')) return json({ data: [], total: 0 });
      return json({ data: [] });
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('tells Entra admins to enter the Application (client) ID, not a URL', async () => {
    render(<McpServerSettings />);
    const input = await screen.findByLabelText('Audience');
    expect(input).toHaveAttribute('placeholder', 'e.g. 00000000-0000-0000-0000-000000000000');
    expect(input).toHaveValue('');
    const help = document.getElementById('idp-audience-help')!;
    expect(help.textContent).toContain('Application (client) ID');
    expect(help.textContent).toContain("won't be accepted here");
    expect(help.textContent).not.toContain('`');
  });

  it("pre-fills Google with the server's canonical MCP URL and clears it on switching away", async () => {
    render(<McpServerSettings />);
    await screen.findByLabelText('Audience');
    // Wait for the suggestions call so the canonical URL (not the jsdom origin) is used.
    await vi.waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('/idp-suggestions'))).toBe(true),
    );
    const kind = screen.getByTestId('idp-kind');

    fireEvent.change(kind, { target: { value: 'google' } });
    expect(await screen.findByDisplayValue(MCP_RESOURCE)).toHaveAttribute('id', 'idp-audience-g');
    expect(screen.queryByText(/needs no setup/)).not.toBeInTheDocument();
    expect(document.getElementById('idp-audience-g-help')!.textContent).toContain('exactly this audience');

    fireEvent.change(kind, { target: { value: 'microsoft' } });
    expect(screen.getByLabelText('Audience')).toHaveValue('');
  });

  it('keeps an audience the admin typed when switching providers', async () => {
    render(<McpServerSettings />);
    fireEvent.change(await screen.findByLabelText('Audience'), { target: { value: 'my-api' } });
    fireEvent.change(screen.getByTestId('idp-kind'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('Audience')).toHaveValue('my-api');
    expect(screen.getByLabelText('Audience')).toHaveAttribute('placeholder', MCP_RESOURCE);
  });
});
