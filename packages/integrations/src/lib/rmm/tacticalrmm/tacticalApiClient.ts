import axios, { AxiosError, AxiosInstance } from 'axios';

export type TacticalRmmAuthMode = 'api_key' | 'knox';

export interface TacticalBetaPage<T> {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: T[];
}

export function normalizeTacticalBaseUrl(input: string): string {
  const raw = (input || '').trim();
  if (!raw) return '';

  const withProto = raw.startsWith('http://') || raw.startsWith('https://')
    ? raw
    : `https://${raw}`;

  const url = new URL(withProto);
  const pathname = url.pathname.replace(/\/+$/, '');
  const normalizedPath = pathname === '/api' ? '' : pathname;
  return `${url.protocol}//${url.host}${normalizedPath}`;
}

export function isAxiosUnauthorized(err: unknown): boolean {
  return Boolean((err as AxiosError | undefined)?.response?.status === 401);
}

export class TacticalRmmClient {
  private readonly ax: AxiosInstance;

  constructor(
    private readonly opts: {
      baseUrl: string;
      authMode: TacticalRmmAuthMode;
      apiKey?: string;
      knoxToken?: string;
      refreshKnoxToken?: () => Promise<string>;
      onKnoxTokenRefreshed?: (token: string) => Promise<void>;
    }
  ) {
    this.ax = axios.create({
      baseURL: normalizeTacticalBaseUrl(opts.baseUrl),
      timeout: 30_000,
    });
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.opts.authMode === 'api_key') {
      if (!this.opts.apiKey) throw new Error('Tactical API key is not configured');
      return { 'X-API-KEY': this.opts.apiKey };
    }

    if (!this.opts.knoxToken && !this.opts.refreshKnoxToken) {
      throw new Error('Tactical Knox token is not configured');
    }

    if (!this.opts.knoxToken && this.opts.refreshKnoxToken) {
      const token = await this.opts.refreshKnoxToken();
      this.opts.knoxToken = token;
      await this.opts.onKnoxTokenRefreshed?.(token);
    }

    return { Authorization: `Token ${this.opts.knoxToken}` };
  }

  async request<T>(args: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    params?: Record<string, any>;
    data?: any;
    // Avoid infinite loops: one refresh attempt max.
    _didRefresh?: boolean;
  }): Promise<T> {
    const headers = await this.authHeaders();

    try {
      const res = await this.ax.request<T>({
        method: args.method,
        url: args.path,
        params: args.params,
        data: args.data,
        headers,
      });
      return res.data;
    } catch (err) {
      if (
        this.opts.authMode === 'knox' &&
        !args._didRefresh &&
        isAxiosUnauthorized(err) &&
        this.opts.refreshKnoxToken
      ) {
        const token = await this.opts.refreshKnoxToken();
        this.opts.knoxToken = token;
        await this.opts.onKnoxTokenRefreshed?.(token);
        return this.request<T>({ ...args, _didRefresh: true });
      }
      throw err;
    }
  }

  async listAllBeta<T>(args: {
    path: string;
    params?: Record<string, any>;
    pageSize?: number;
  }): Promise<T[]> {
    const pageSize = Math.min(args.pageSize ?? 1000, 1000);
    const first = await this.request<any>({
      method: 'GET',
      path: args.path,
      params: { ...(args.params || {}), page_size: pageSize, page: 1 },
    });

    // Some Tactical beta endpoints may return an array rather than DRF pagination.
    if (Array.isArray(first)) return first as T[];

    const page = first as TacticalBetaPage<T>;
    const results: T[] = [...(page.results || [])];

    let pageNum = 1;
    let next = page.next;
    while (next) {
      pageNum += 1;
      const nextPage = await this.request<TacticalBetaPage<T>>({
        method: 'GET',
        path: args.path,
        params: { ...(args.params || {}), page_size: pageSize, page: pageNum },
      });
      results.push(...(nextPage.results || []));
      next = nextPage.next;
    }

    return results;
  }

  async checkCreds(input: { username: string; password: string }): Promise<{ totp: boolean }> {
    const res = await axios.post(new URL('/api/v2/checkcreds/', this.ax.defaults.baseURL!).toString(), input, {
      timeout: 30_000,
    });
    return { totp: Boolean((res.data as any)?.totp) };
  }

  async login(input: { username: string; password: string; totpCode?: string }): Promise<{ token: string }> {
    const payload: Record<string, any> = { username: input.username, password: input.password };
    if (input.totpCode) payload.twofactor = input.totpCode;
    const res = await axios.post(new URL('/api/v2/login/', this.ax.defaults.baseURL!).toString(), payload, {
      timeout: 30_000,
    });
    const token: string | undefined =
      (res.data as any)?.token ||
      (res.data as any)?.auth_token ||
      (res.data as any)?.key;

    if (!token) throw new Error('Login succeeded but no token was returned');
    return { token };
  }
}

