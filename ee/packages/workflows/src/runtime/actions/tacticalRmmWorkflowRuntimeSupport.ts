import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const TACTICAL_API_KEY_SECRET = 'tacticalrmm_api_key';
const TACTICAL_KNOX_USERNAME_SECRET = 'tacticalrmm_username';
const TACTICAL_KNOX_PASSWORD_SECRET = 'tacticalrmm_password';
const TACTICAL_KNOX_TOKEN_SECRET = 'tacticalrmm_knox_token';

export type TacticalAuthMode = 'api_key' | 'knox';

export type TacticalIntegrationConfig = {
  tenantId: string;
  instanceUrl: string;
  authMode: TacticalAuthMode;
};

export type TacticalRunScriptPayload = {
  script: number;
  args?: string[];
  env_vars?: string[];
  timeout?: number;
  run_as_user?: boolean;
  output?: 'wait' | 'forget';
};

export type TacticalRunCommandPayload = {
  shell: string;
  cmd: string;
  timeout?: number;
  run_as_user?: boolean;
};

export type TacticalWorkflowClient = {
  listAgents(params?: Record<string, string | number | undefined>): Promise<Record<string, unknown>[]>;
  getAgent(agentId: string): Promise<Record<string, unknown>>;
  listScripts(): Promise<Record<string, unknown>[]>;
  runScript(agentId: string, payload: TacticalRunScriptPayload): Promise<unknown>;
  runCommand(agentId: string, payload: TacticalRunCommandPayload): Promise<unknown>;
  rebootAgent(agentId: string): Promise<void>;
};

// Mirrors normalizeTacticalBaseUrl in packages/integrations; the workflows
// package cannot import that package at runtime (dist marks @alga-psa/* as
// external and the runtime subpath maps to TS source), so the client is
// self-contained NinjaOne-style.
export const normalizeTacticalBaseUrl = (input: string): string => {
  const raw = (input || '').trim();
  if (!raw) return '';
  const withProto = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  const url = new URL(withProto);
  const pathname = url.pathname.replace(/\/+$/, '');
  const normalizedPath = pathname === '/api' ? '' : pathname;
  return `${url.protocol}//${url.host}${normalizedPath}`;
};

const getResponseText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const parseBody = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

type TacticalBetaPage = {
  count?: number;
  next?: string | null;
  results?: unknown[];
};

export class FetchTacticalWorkflowClient implements TacticalWorkflowClient {
  private knoxToken: string | null = null;

  constructor(private readonly config: TacticalIntegrationConfig) {}

  private get baseUrl(): string {
    return normalizeTacticalBaseUrl(this.config.instanceUrl);
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const secretProvider = await getSecretProviderInstance();
    if (this.config.authMode === 'api_key') {
      const apiKey = await secretProvider.getTenantSecret(this.config.tenantId, TACTICAL_API_KEY_SECRET);
      if (!apiKey) throw new Error('Tactical RMM API key is not configured for this tenant');
      return { 'X-API-KEY': apiKey };
    }
    if (!this.knoxToken) {
      this.knoxToken = (await secretProvider.getTenantSecret(this.config.tenantId, TACTICAL_KNOX_TOKEN_SECRET)) ?? null;
    }
    if (!this.knoxToken) {
      await this.refreshKnoxToken();
    }
    return { Authorization: `Token ${this.knoxToken}` };
  }

  private async refreshKnoxToken(): Promise<void> {
    const secretProvider = await getSecretProviderInstance();
    const username = await secretProvider.getTenantSecret(this.config.tenantId, TACTICAL_KNOX_USERNAME_SECRET);
    const password = await secretProvider.getTenantSecret(this.config.tenantId, TACTICAL_KNOX_PASSWORD_SECRET);
    if (!username || !password) {
      throw new Error('Tactical RMM Knox credentials are not configured for this tenant');
    }

    const checkResponse = await fetch(`${this.baseUrl}/api/v2/checkcreds/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!checkResponse.ok) {
      throw new Error(`Tactical RMM credential check failed (${checkResponse.status})`);
    }
    const checkBody = parseBody(await getResponseText(checkResponse)) as { totp?: boolean } | null;
    if (checkBody?.totp) {
      throw new Error('Tactical RMM account requires TOTP; Knox token cannot be refreshed automatically');
    }

    const loginResponse = await fetch(`${this.baseUrl}/api/v2/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!loginResponse.ok) {
      throw new Error(`Tactical RMM login failed (${loginResponse.status})`);
    }
    const loginBody = parseBody(await getResponseText(loginResponse)) as Record<string, unknown> | null;
    const token = (loginBody?.token ?? loginBody?.auth_token ?? loginBody?.key) as string | undefined;
    if (!token) {
      throw new Error('Tactical RMM login succeeded but returned no token');
    }
    this.knoxToken = token;
    await secretProvider.setTenantSecret(this.config.tenantId, TACTICAL_KNOX_TOKEN_SECRET, token);
  }

  private async request(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      retryOnUnauthorized?: boolean;
    } = {}
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(await this.authHeaders())
    };

    const response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    });

    if (
      response.status === 401 &&
      this.config.authMode === 'knox' &&
      options.retryOnUnauthorized !== false
    ) {
      await this.refreshKnoxToken();
      return this.request(path, { ...options, retryOnUnauthorized: false });
    }

    if (!response.ok) {
      const body = await getResponseText(response);
      throw new Error(`Tactical RMM API request failed (${response.status}) for ${path}: ${body || response.statusText}`);
    }

    return parseBody(await getResponseText(response));
  }

  async listAgents(params: Record<string, string | number | undefined> = {}): Promise<Record<string, unknown>[]> {
    const pageSize = 1000;
    const agents: Record<string, unknown>[] = [];
    let pageNum = 1;
    for (;;) {
      const data = await this.request('/api/beta/v1/agent/', {
        query: { ...params, page_size: pageSize, page: pageNum }
      });
      if (Array.isArray(data)) {
        agents.push(...(data as Record<string, unknown>[]));
        break;
      }
      const page = (data ?? {}) as TacticalBetaPage;
      agents.push(...((page.results ?? []) as Record<string, unknown>[]));
      if (!page.next) break;
      pageNum += 1;
    }
    return agents;
  }

  async getAgent(agentId: string): Promise<Record<string, unknown>> {
    const data = await this.request(`/api/beta/v1/agent/${encodeURIComponent(agentId)}/`);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`Tactical RMM agent ${agentId} returned an unexpected response`);
    }
    return data as Record<string, unknown>;
  }

  async listScripts(): Promise<Record<string, unknown>[]> {
    const data = await this.request('/scripts/');
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    return [];
  }

  async runScript(agentId: string, payload: TacticalRunScriptPayload): Promise<unknown> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/runscript/`, {
      method: 'POST',
      body: {
        output: payload.output ?? 'wait',
        emails: [],
        emailMode: 'default',
        custom_field: null,
        save_all_output: false,
        script: payload.script,
        args: payload.args ?? [],
        env_vars: payload.env_vars ?? [],
        run_as_user: payload.run_as_user ?? false,
        timeout: payload.timeout ?? 90
      }
    });
  }

  async runCommand(agentId: string, payload: TacticalRunCommandPayload): Promise<unknown> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/cmd/`, {
      method: 'POST',
      body: {
        shell: payload.shell,
        cmd: payload.cmd,
        timeout: payload.timeout ?? 30,
        run_as_user: payload.run_as_user ?? false
      }
    });
  }

  async rebootAgent(agentId: string): Promise<void> {
    await this.request(`/agents/${encodeURIComponent(agentId)}/reboot/`, { method: 'POST' });
  }
}

export async function createTacticalWorkflowClient(config: TacticalIntegrationConfig): Promise<TacticalWorkflowClient> {
  return new FetchTacticalWorkflowClient(config);
}
