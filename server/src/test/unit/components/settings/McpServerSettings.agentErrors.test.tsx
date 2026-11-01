/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpServerSettings from '@/components/settings/mcp/McpServerSettings';

const LIMIT_MSG =
  "You've reached your service principal limit (10). Delete or deactivate a service principal to free a slot.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const agent = {
  agent_id: 'agent-1',
  name: 'Inbox triage',
  description: null,
  idp_issuer: 'https://accounts.google.com',
  idp_subject: '1130',
  active: false,
};

// The agents table renders only once a trusted provider exists.
const idp = {
  issuer: 'https://accounts.google.com',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  audience: null,
  subject_claim: 'sub',
  kind: 'google',
  active: true,
};

describe('McpServerSettings agent write errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the server message and reverts the row when reactivation is rejected at the limit', async () => {
    const patches: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/v1/mcp/agents') && method === 'PATCH') {
        patches.push(JSON.parse(String(init?.body)));
        return json({ error: LIMIT_MSG, code: 'LIMIT_REACHED' }, 409);
      }
      if (url.endsWith('/api/v1/mcp/agents')) return json({ data: [agent] });
      if (url.endsWith('/api/v1/mcp/idp-providers')) return json({ data: [idp] });
      if (url.endsWith('/api/v1/mcp/platform-providers')) return json({ data: [] });
      if (url.endsWith('/api/v1/mcp/idp-suggestions')) return json({ data: {} });
      return json({ data: [] });
    });

    const user = userEvent.setup();
    render(<McpServerSettings />);

    const row = (await screen.findByText('Inbox triage')).closest('tr')!;
    expect(within(row).getByText('Inactive')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Open agent actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reactivate' }));

    await waitFor(() => {
      expect(document.getElementById('mcp-error')).toHaveTextContent(LIMIT_MSG);
    });
    expect(patches).toEqual([{ agentId: 'agent-1', active: true }]);
    const rowAfter = screen.getByText('Inbox triage').closest('tr')!;
    expect(within(rowAfter).getByText('Inactive')).toBeInTheDocument();
    expect(within(rowAfter).queryByText('Active')).not.toBeInTheDocument();
  });
});
