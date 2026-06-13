import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const secretMocks = vi.hoisted(() => ({
  getTenantSecret: vi.fn(),
  setTenantSecret: vi.fn()
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: secretMocks.getTenantSecret,
    setTenantSecret: secretMocks.setTenantSecret
  })
}));

import { FetchTacticalWorkflowClient } from '../tacticalRmmWorkflowRuntimeSupport';

const withSecrets = (secrets: Record<string, string | null>) => {
  secretMocks.getTenantSecret.mockImplementation(async (_tenant: string, name: string) => secrets[name] ?? null);
};

beforeEach(() => {
  secretMocks.getTenantSecret.mockReset();
  secretMocks.setTenantSecret.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FetchTacticalWorkflowClient (T008)', () => {
  it('sends X-API-KEY auth and the documented runscript payload', async () => {
    withSecrets({ tacticalrmm_api_key: 'key-123' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify('ok'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchTacticalWorkflowClient({
      tenantId: 'tenant-1',
      instanceUrl: 'https://api.tactical.example.com/',
      authMode: 'api_key'
    });
    await client.runScript('agent-abc', { script: 89, args: ['a'], timeout: 60 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.tactical.example.com/agents/agent-abc/runscript/');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-KEY']).toBe('key-123');
    expect(JSON.parse(init.body)).toMatchObject({
      script: 89,
      args: ['a'],
      timeout: 60,
      output: 'wait',
      run_as_user: false
    });
  });

  it('refreshes the Knox token on 401, persists it, and retries once', async () => {
    withSecrets({
      tacticalrmm_knox_token: 'stale-token',
      tacticalrmm_username: 'tech',
      tacticalrmm_password: 'pw'
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ totp: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'fresh-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, name: 's' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchTacticalWorkflowClient({
      tenantId: 'tenant-1',
      instanceUrl: 'https://api.tactical.example.com',
      authMode: 'knox'
    });
    const scripts = await client.listScripts();

    expect(scripts).toEqual([{ id: 1, name: 's' }]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Token stale-token');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.tactical.example.com/api/v2/checkcreds/');
    expect(fetchMock.mock.calls[2][0]).toBe('https://api.tactical.example.com/api/v2/login/');
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Token fresh-token');
    expect(secretMocks.setTenantSecret).toHaveBeenCalledWith('tenant-1', 'tacticalrmm_knox_token', 'fresh-token');
  });

  it('paginates the beta agent list and sends cmd payloads to the documented path', async () => {
    withSecrets({ tacticalrmm_api_key: 'key-123' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ next: 'page2', results: [{ agent_id: 'a1' }] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ next: null, results: [{ agent_id: 'a2' }] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify('pong'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchTacticalWorkflowClient({
      tenantId: 'tenant-1',
      instanceUrl: 'api.tactical.example.com',
      authMode: 'api_key'
    });

    const agents = await client.listAgents();
    expect(agents.map((a) => a.agent_id)).toEqual(['a1', 'a2']);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/beta/v1/agent/?');
    expect(fetchMock.mock.calls[0][0]).toContain('page=1');
    expect(fetchMock.mock.calls[1][0]).toContain('page=2');

    await client.runCommand('agent-abc', { shell: 'cmd', cmd: 'ping host' });
    expect(fetchMock.mock.calls[2][0]).toBe('https://api.tactical.example.com/agents/agent-abc/cmd/');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ shell: 'cmd', cmd: 'ping host', timeout: 30 });
  });

  it('surfaces vendor failures with status and body, never credentials', async () => {
    withSecrets({ tacticalrmm_api_key: 'key-123' });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('agent offline', { status: 400 })));

    const client = new FetchTacticalWorkflowClient({
      tenantId: 'tenant-1',
      instanceUrl: 'https://api.tactical.example.com',
      authMode: 'api_key'
    });

    const error = await client.rebootAgent('agent-abc').catch((err: unknown) => err as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/400.*agent offline/);
    expect((error as Error).message).not.toContain('key-123');
  });
});
