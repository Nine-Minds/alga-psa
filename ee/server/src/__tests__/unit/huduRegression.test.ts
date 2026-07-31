/**
 * T110–T114 — Hudu regression suite (regression group).
 *
 * T110 security sweep: STATIC grep-style assertions over every Hudu source
 *   file (lib + actions + components, CE wrappers and EE stubs included) that
 *   no code path can write a password value to knex, the secret provider, the
 *   reference cache, or a log sink — plus a behavioral allowlist check of
 *   toHuduAssetPasswordSummary with a poisoned record. The behavioral
 *   reveal-path guarantees (single GET, zero persistence, fail-closed audit,
 *   value never logged) are already covered by T067/T068 in
 *   huduDataActions.test.ts and are referenced, not duplicated.
 * T111 disconnect → reconnect with a NEW key serves fresh data: disconnect
 *   clears the tenant's reference cache (clearHuduReferenceCacheForTenant —
 *   added by this group; disconnect previously left the cache populated, so a
 *   reconnect within the 60s TTL could serve keyA-era lists).
 * T112 tenant isolation (unit half): reference-cache keys are tenant-prefixed
 *   — poisoning tenant A's cache can never produce a hit for tenant B. The
 *   DB half (mapping rows invisible across tenants) lives in
 *   hudu-regression.integration.test.ts.
 * T113 Hudu unreachable: every read action degrades to a typed error state
 *   without throwing.
 * T114 clearing a mapping takes effect immediately: actions re-resolve the
 *   mapping on every call (no memoized resolution), so the next fetch returns
 *   unmapped.
 *
 * Mock idioms mirror huduDataActions.test.ts / huduConnectionActions.test.ts;
 * the reference cache (referenceData.ts) stays REAL throughout.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TENANT = 'tenant-hudu-regression';
const OTHER_TENANT = 'tenant-hudu-other';
const CLIENT_1 = '11111111-1111-1111-1111-111111111111';
const BASE_URL = 'https://docs.example.com';
const API_KEY_A = 'first-api-key-aaa';
const API_KEY_B = 'second-api-key-bbb';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();

const knexCallableMock = vi.fn();
const createTenantKnexMock = vi.fn();

// In-memory secret store: connect/disconnect mutate it like the real provider.
const secretStore = new Map<string, string>();
const getTenantSecretMock = vi.fn();
const setTenantSecretMock = vi.fn();
const deleteTenantSecretMock = vi.fn();

// In-memory hudu_integrations row.
let integrationRow: Record<string, unknown> | null = null;
const getHuduIntegrationMock = vi.fn();
const upsertHuduIntegrationMock = vi.fn();
const setHuduIntegrationActiveMock = vi.fn();
const touchHuduIntegrationLastSyncedMock = vi.fn();

const resolveCompanyIdMock = vi.fn();

const getAssetsMock = vi.fn();
const getArticlesMock = vi.fn();
const getAssetPasswordsMock = vi.fn();
const getAssetPasswordMock = vi.fn();
const createHuduClientMock = vi.fn();

const validateConnectionMock = vi.fn();
const huduClientConstructorSpy = vi.fn();

const revealAuditMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      handler(internalUser, { tenant: TENANT }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: { isEnabled: isEnabledMock },
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: getTenantSecretMock,
    setTenantSecret: setTenantSecretMock,
    deleteTenantSecret: deleteTenantSecretMock,
  })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: getHuduIntegrationMock,
  upsertHuduIntegration: upsertHuduIntegrationMock,
  setHuduIntegrationActive: setHuduIntegrationActiveMock,
  touchHuduIntegrationLastSynced: touchHuduIntegrationLastSyncedMock,
}));

// Keep parseCompaniesCache real; fake only the knex-level mapping resolver.
vi.mock('@ee/lib/integrations/hudu/companyMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveHuduCompanyIdForClient: resolveCompanyIdMock,
}));

// Keep HuduRequestError real; fake the factory (data actions) + the class
// (connection actions' validateConnection).
vi.mock('@ee/lib/integrations/hudu/huduClient', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createHuduClient: createHuduClientMock,
  HuduClient: class {
    constructor(config: unknown) {
      huduClientConstructorSpy(config);
    }
    validateConnection = validateConnectionMock;
  },
}));

vi.mock('@ee/lib/integrations/hudu/revealAudit', () => ({
  writeHuduPasswordRevealAudit: revealAuditMock,
}));

// Dynamic imports: a static import would invoke the partial module factories
// before the mock consts above are initialized (TDZ).
const { HuduRequestError } = await import('@ee/lib/integrations/hudu/huduClient');
const {
  clearHuduReferenceCache,
  clearHuduReferenceCacheForTenant,
  getCachedHuduList,
  getHuduReferenceCacheSize,
  setCachedHuduList,
  toHuduAssetPasswordSummary,
} = await import('@ee/lib/integrations/hudu/referenceData');

async function importDataActions() {
  return import('@ee/lib/actions/integrations/huduDataActions');
}

async function importConnectionActions() {
  return import('@ee/lib/actions/integrations/huduActions');
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHuduReferenceCache();
  secretStore.clear();
  integrationRow = null;
  delete process.env.HUDU_API_KEY;
  delete process.env.HUDU_BASE_URL;

  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getTenantSecretMock.mockImplementation(
    async (tenant: string, name: string) => secretStore.get(`${tenant}:${name}`) ?? null
  );
  setTenantSecretMock.mockImplementation(async (tenant: string, name: string, value: string) => {
    secretStore.set(`${tenant}:${name}`, value);
  });
  deleteTenantSecretMock.mockImplementation(async (tenant: string, name: string) => {
    secretStore.delete(`${tenant}:${name}`);
  });

  getHuduIntegrationMock.mockImplementation(async () => integrationRow);
  upsertHuduIntegrationMock.mockImplementation(async (_knex, tenant, input) => {
    integrationRow = {
      tenant,
      integration_id: 'integration-1',
      ...(integrationRow ?? {}),
      ...input,
      settings: input.settings ?? (integrationRow?.settings as Record<string, unknown>) ?? {},
    };
    return integrationRow;
  });
  setHuduIntegrationActiveMock.mockImplementation(async (_knex, _tenant, isActive: boolean) => {
    if (integrationRow) integrationRow.is_active = isActive;
  });

  resolveCompanyIdMock.mockImplementation(async (_knex, _tenant, clientId) =>
    clientId === CLIENT_1 ? '101' : null
  );

  // vi.clearAllMocks keeps per-test mockRejectedValue overrides — restore the
  // default implementations here so T113's failures never leak across tests.
  createHuduClientMock.mockImplementation(async () => ({
    getAssets: getAssetsMock,
    getArticles: getArticlesMock,
    getAssetPasswords: getAssetPasswordsMock,
    getAssetPassword: getAssetPasswordMock,
  }));
  getAssetsMock.mockResolvedValue([{ id: 1, company_id: 101, name: 'Asset', url: null }]);
  getArticlesMock.mockResolvedValue([{ id: 7, company_id: 101, name: 'Runbook', url: null }]);
  getAssetPasswordsMock.mockResolvedValue([
    { id: 42, company_id: 101, name: 'WiFi', username: 'admin', password: 'secret', url: null },
  ]);
  getAssetPasswordMock.mockResolvedValue({ id: 42, company_id: 101, name: 'WiFi', password: 'secret' });
  revealAuditMock.mockResolvedValue(undefined);
  validateConnectionMock.mockResolvedValue({ ok: true, connected: true, passwordAccess: true });
});

// ============================================================================
// T110 — static security sweep over every Hudu source file
// ============================================================================

const repoRoot = path.resolve(process.cwd(), '..', '..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'build',
  '.next',
  '.turbo',
  '.git',
  '__tests__',
  'docs',
]);

/** Every non-test source file whose repo-relative path mentions hudu. */
function collectHuduSourceFiles(): string[] {
  const roots = [
    path.join(repoRoot, 'ee', 'server', 'src'),
    path.join(repoRoot, 'server', 'src'),
    path.join(repoRoot, 'packages'),
  ];
  const hits: string[] = [];
  for (const root of roots) {
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) stack.push(fullPath);
          continue;
        }
        if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
        if (/\.(test|spec)\./.test(entry.name)) continue;
        const relative = path.relative(repoRoot, fullPath);
        if (/hudu/i.test(relative)) hits.push(relative);
      }
    }
  }
  return hits.sort();
}

/** Balanced-paren argument text of every `<callee>(…)` occurrence. */
function extractCallArgs(source: string, calleePattern: RegExp): string[] {
  const args: string[] = [];
  const re = new RegExp(calleePattern.source, 'g');
  for (let match = re.exec(source); match !== null; match = re.exec(source)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < source.length && depth > 0 && i - start < 2000) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
      i += 1;
    }
    args.push(source.slice(start, i - 1));
  }
  return args;
}

/** Known non-value identifiers that legitimately contain "password". */
const PASSWORD_TOKEN_ALLOWLIST = [
  'password_access',
  'password_folder_name',
  'hudu_password_id',
  'huduPasswordId',
  'passwordAccess',
];

function stripAllowlisted(text: string): string {
  let result = text;
  for (const token of PASSWORD_TOKEN_ALLOWLIST) {
    result = result.split(token).join('');
  }
  return result;
}

describe('T110: security sweep — no code path can write a password value', () => {
  const files = collectHuduSourceFiles();
  const sources = files.map((relative) => ({
    relative,
    source: fs.readFileSync(path.join(repoRoot, relative), 'utf8'),
  }));

  it('the sweep covers the full Hudu surface (lib + actions + components + routes)', () => {
    const expected = [
      'ee/server/src/lib/integrations/hudu/huduClient.ts',
      'ee/server/src/lib/integrations/hudu/referenceData.ts',
      'ee/server/src/lib/integrations/hudu/companyMapping.ts',
      'ee/server/src/lib/integrations/hudu/huduIntegrationRepository.ts',
      'ee/server/src/lib/integrations/hudu/revealAudit.ts',
      'ee/server/src/lib/integrations/hudu/secrets.ts',
      'ee/server/src/lib/integrations/hudu/layoutFieldSchema.ts',
      'ee/server/src/lib/actions/integrations/huduActions.ts',
      'ee/server/src/lib/actions/integrations/huduDataActions.ts',
      'ee/server/src/lib/actions/integrations/huduMappingActions.ts',
      'ee/server/src/lib/actions/integrations/huduLayoutMapActions.ts',
      'ee/server/src/lib/actions/integrations/huduAssetMappingActions.ts',
      'ee/server/src/lib/actions/integrations/huduAssetImportActions.ts',
      'ee/server/src/lib/actions/integrations/huduAssetSyncActions.ts',
      'ee/server/src/lib/actions/integrations/huduGlobalDocsActions.ts',
      'ee/server/src/components/integrations/hudu/HuduClientTab.tsx',
      'ee/server/src/components/integrations/hudu/HuduClientPasswordsTab.tsx',
      'ee/server/src/components/settings/integrations/HuduIntegrationSettings.tsx',
      'ee/server/src/components/settings/integrations/hudu/HuduCompanyMappingManager.tsx',
      'ee/server/src/components/settings/integrations/hudu/HuduLayoutCreateTypeButton.tsx',
      'ee/server/src/app/api/integrations/hudu/route.ts',
      'server/src/app/api/integrations/hudu/route.ts',
      'packages/clients/src/components/clients/HuduClientPasswordsTab.tsx',
      'packages/clients/src/components/clients/useHuduClientTab.ts',
      'packages/ee/src/lib/actions/integrations/huduDataActions.ts',
    ];
    for (const file of expected) {
      expect(files, `sweep must include ${file}`).toContain(file);
    }
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it('knex writes (insert/update/merge) never reference a password value field', () => {
    const offenders: string[] = [];
    for (const { relative, source } of sources) {
      for (const arg of extractCallArgs(source, /\.(?:insert|update|merge)\s*\(/)) {
        if (/password|otp_secret/i.test(stripAllowlisted(arg))) {
          offenders.push(`${relative}: ${arg.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('setTenantSecret is only ever called with the two known Hudu key names', () => {
    const callSites: string[] = [];
    for (const { relative, source } of sources) {
      for (const arg of extractCallArgs(source, /\bsetTenantSecret\s*\(/)) {
        callSites.push(`${relative}: ${arg}`);
        expect(arg, `${relative}: setTenantSecret must use HUDU_SECRET_KEYS`).toMatch(
          /HUDU_SECRET_KEYS\.(apiKey|baseUrl)/
        );
        // Never a password/otp value.
        expect(stripAllowlisted(arg)).not.toMatch(/password|otp/i);
      }
    }
    // Sanity: the two connectHudu writes exist (key + base URL).
    expect(callSites.filter((site) => site.includes('HUDU_SECRET_KEYS.apiKey'))).toHaveLength(1);
    expect(callSites.filter((site) => site.includes('HUDU_SECRET_KEYS.baseUrl'))).toHaveLength(1);
  });

  it('the reference cache is only populated with already-projected items', () => {
    // Static half: every setCachedHuduList call site passes the projected
    // `items` (huduDataActions projects BEFORE caching — behavioral proof in
    // T062/T063, huduDataActions.test.ts).
    for (const { relative, source } of sources) {
      if (relative.endsWith('referenceData.ts')) continue; // the definition itself
      for (const arg of extractCallArgs(source, /\bsetCachedHuduList\s*\(/)) {
        expect(stripAllowlisted(arg), `${relative}: raw records must never be cached`).not.toMatch(
          /password|otp|raw\b/i
        );
      }
    }
  });

  it('toHuduAssetPasswordSummary strips password/otp/unknown fields from a poisoned record (allowlist projection)', () => {
    const poisoned = {
      id: 42,
      company_id: 101,
      name: 'WiFi',
      username: 'admin',
      password: 'PLAINTEXT-SENTINEL',
      otp_secret: 'OTP-SENTINEL',
      totp_code: 'TOTP-SENTINEL',
      some_future_hudu_field: 'UNKNOWN-SENTINEL',
      url: '/passwords/42',
      password_folder_name: 'Network',
      description: 'desc',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    };

    const summary = toHuduAssetPasswordSummary(poisoned as never);

    expect(Object.keys(summary).sort()).toEqual([
      'company_id',
      'created_at',
      'description',
      'id',
      'name',
      'password_folder_name',
      'updated_at',
      'url',
      'username',
    ]);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('PLAINTEXT-SENTINEL');
    expect(serialized).not.toContain('OTP-SENTINEL');
    expect(serialized).not.toContain('TOTP-SENTINEL');
    expect(serialized).not.toContain('UNKNOWN-SENTINEL');
  });

  it('logger calls never interpolate a password/otp value or credential', () => {
    const offenders: string[] = [];
    const forbidden = [/\brecord\b/, /\.password\b/, /\botp_secret\b/, /\bapiKey\b/, /\bapi_key\b/, /\bvalue\b/];
    for (const { relative, source } of sources) {
      for (const arg of extractCallArgs(source, /\blogger\.(?:info|warn|error|debug)\s*\(/)) {
        const cleaned = stripAllowlisted(arg);
        if (forbidden.some((pattern) => pattern.test(cleaned))) {
          offenders.push(`${relative}: ${arg.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('console calls (CE delegator load-failure log only) never carry a value either', () => {
    const offenders: string[] = [];
    const forbidden = [/\brecord\b/, /\.password\b/, /\botp_secret\b/, /\bapiKey\b/, /\bapi_key\b/, /\bvalue\b/];
    for (const { relative, source } of sources) {
      for (const arg of extractCallArgs(source, /\bconsole\.(?:log|info|warn|error|debug)\s*\(/)) {
        if (forbidden.some((pattern) => pattern.test(stripAllowlisted(arg)))) {
          offenders.push(`${relative}: ${arg.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ============================================================================
// T111 — disconnect → reconnect with a NEW key serves fresh data
// ============================================================================

describe('T111: disconnect then reconnect with a new key works and serves fresh data', () => {
  it('full lifecycle: connect(keyA) → fetch (cached) → disconnect (secrets + cache gone) → connect(keyB) → fresh fetch', async () => {
    const { connectHudu, disconnectHudu, getHuduConnectionStatus } = await importConnectionActions();
    const { getHuduCompanyPasswords } = await importDataActions();

    // Phase 1 — connect with key A.
    getAssetPasswordsMock.mockResolvedValue([
      { id: 1, company_id: 101, name: 'KeyA Password', username: 'a', password: 'keyA-secret', url: null },
    ]);
    const connectedA = await connectHudu({ baseUrl: BASE_URL, apiKey: API_KEY_A });
    expect(connectedA).toMatchObject({ success: true, data: { connected: true } });
    expect(secretStore.get(`${TENANT}:hudu_api_key`)).toBe(API_KEY_A);

    // Fetch under key A; second call proves the cache is live (would go stale).
    const first = await getHuduCompanyPasswords(CLIENT_1);
    const second = await getHuduCompanyPasswords(CLIENT_1);
    expect(first).toMatchObject({ state: 'ok', fromCache: false });
    expect(second).toMatchObject({ state: 'ok', fromCache: true });
    expect(JSON.stringify(second)).toContain('KeyA Password');
    expect(getHuduReferenceCacheSize()).toBe(1);

    // Phase 2 — disconnect: secrets deleted AND the tenant's cache cleared.
    const disconnected = await disconnectHudu();
    expect(disconnected).toEqual({ success: true, data: { disconnected: true } });
    expect(secretStore.has(`${TENANT}:hudu_api_key`)).toBe(false);
    expect(secretStore.has(`${TENANT}:hudu_base_url`)).toBe(false);
    expect(getHuduReferenceCacheSize()).toBe(0); // keyA-era data cannot survive

    // Phase 3 — reconnect with key B; status is connected again.
    getAssetPasswordsMock.mockResolvedValue([
      { id: 2, company_id: 101, name: 'KeyB Password', username: 'b', password: 'keyB-secret', url: null },
    ]);
    const connectedB = await connectHudu({ baseUrl: BASE_URL, apiKey: API_KEY_B });
    expect(connectedB).toMatchObject({ success: true, data: { connected: true } });
    expect(secretStore.get(`${TENANT}:hudu_api_key`)).toBe(API_KEY_B);
    expect(await getHuduConnectionStatus()).toMatchObject({
      success: true,
      data: { connected: true, isActive: true },
    });

    // Phase 4 — even WITHOUT refresh, the next fetch cannot serve keyA-era
    // data: disconnect emptied the cache, so this is a live key-B fetch.
    const fresh = await getHuduCompanyPasswords(CLIENT_1);
    expect(fresh).toMatchObject({ state: 'ok', fromCache: false });
    const serialized = JSON.stringify(fresh);
    expect(serialized).toContain('KeyB Password');
    expect(serialized).not.toContain('KeyA Password');
  });

  it('clearHuduReferenceCacheForTenant only drops the disconnecting tenant (other tenants unaffected)', () => {
    setCachedHuduList(TENANT, '101', 'assets', [{ id: 1 }]);
    setCachedHuduList(TENANT, '101', 'articles', [{ id: 2 }]);
    setCachedHuduList(OTHER_TENANT, '101', 'assets', [{ id: 3 }]);

    clearHuduReferenceCacheForTenant(TENANT);

    expect(getCachedHuduList(TENANT, '101', 'assets')).toBeNull();
    expect(getCachedHuduList(TENANT, '101', 'articles')).toBeNull();
    expect(getCachedHuduList(OTHER_TENANT, '101', 'assets')).not.toBeNull();
  });
});

// ============================================================================
// T112 — tenant isolation (unit half: cache keying)
// ============================================================================

describe('T112: reference-cache keys are tenant-prefixed (no cross-tenant hits)', () => {
  it('poisoning tenant A’s cache never produces a hit for tenant B', () => {
    setCachedHuduList(TENANT, '101', 'assets', [{ id: 1, name: 'tenant-A-only' }]);

    expect(getCachedHuduList(OTHER_TENANT, '101', 'assets')).toBeNull();
    expect(getCachedHuduList(TENANT, '101', 'assets')).toMatchObject({
      items: [{ id: 1, name: 'tenant-A-only' }],
    });
  });

  it('the same company id under different tenants resolves to distinct entries', () => {
    setCachedHuduList(TENANT, '101', 'asset_passwords', [{ id: 1, name: 'A' }]);
    setCachedHuduList(OTHER_TENANT, '101', 'asset_passwords', [{ id: 2, name: 'B' }]);

    expect(getCachedHuduList(TENANT, '101', 'asset_passwords')).toMatchObject({ items: [{ id: 1, name: 'A' }] });
    expect(getCachedHuduList(OTHER_TENANT, '101', 'asset_passwords')).toMatchObject({
      items: [{ id: 2, name: 'B' }],
    });
  });
});

// ============================================================================
// T113 — Hudu unreachable degrades every read action to a typed error state
// ============================================================================

function networkError() {
  return new HuduRequestError({ kind: 'network_error', message: 'Hudu could not be reached.' });
}

describe('T113: network_error degrades every surface to a typed error state without throwing', () => {
  it.each([
    ['getHuduCompanyAssets', getAssetsMock],
    ['getHuduCompanyArticles', getArticlesMock],
    ['getHuduCompanyPasswords', getAssetPasswordsMock],
  ] as const)('%s resolves { state: error, errorKind: network_error }', async (actionName, fetchMock) => {
    fetchMock.mockRejectedValue(networkError());
    const actions = await importDataActions();
    const action = actions[actionName] as (clientId: string) => Promise<unknown>;

    const result = await action(CLIENT_1);

    expect(result).toEqual({
      state: 'error',
      error: 'Hudu could not be reached.',
      errorKind: 'network_error',
    });
  });

  it('revealHuduPassword resolves the typed error state (and no value) when Hudu is unreachable', async () => {
    getAssetPasswordMock.mockRejectedValue(networkError());
    const { revealHuduPassword } = await importDataActions();

    const result = await revealHuduPassword(CLIENT_1, 42);

    expect(result).toEqual({
      state: 'error',
      error: 'Hudu could not be reached.',
      errorKind: 'network_error',
    });
    expect('value' in (result as Record<string, unknown>)).toBe(false);
    expect(revealAuditMock).not.toHaveBeenCalled();
  });

  it('a failing client factory (e.g. DNS at construction) also degrades to the error state', async () => {
    createHuduClientMock.mockRejectedValue(networkError());
    const { getHuduCompanyAssets } = await importDataActions();

    const result = await getHuduCompanyAssets(CLIENT_1);

    expect(result).toMatchObject({ state: 'error', errorKind: 'network_error' });
  });

  it('getHuduClientContext never throws while Hudu is unreachable (it makes no Hudu call)', async () => {
    integrationRow = { tenant: TENANT, is_active: true, base_url: BASE_URL, settings: {} };
    createHuduClientMock.mockRejectedValue(networkError());
    getAssetsMock.mockRejectedValue(networkError());
    const { getHuduClientContext } = await importDataActions();

    const result = await getHuduClientContext(CLIENT_1);

    expect(result).toEqual({ connected: true, mapped: true });
    expect(createHuduClientMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T114 — clearing a mapping takes effect on the very next fetch
// ============================================================================

describe('T114: actions re-resolve the mapping per call — a cleared mapping is unmapped immediately', () => {
  it.each([['getHuduCompanyAssets'], ['getHuduCompanyPasswords']] as const)(
    '%s returns unmapped right after the mapping is cleared (even with warm cache)',
    async (actionName) => {
      let mappingCleared = false;
      resolveCompanyIdMock.mockImplementation(async (_knex, _tenant, clientId) =>
        !mappingCleared && clientId === CLIENT_1 ? '101' : null
      );
      const actions = await importDataActions();
      const action = actions[actionName] as (clientId: string) => Promise<unknown>;

      const before = await action(CLIENT_1);
      expect(before).toMatchObject({ state: 'ok' });
      expect(getHuduReferenceCacheSize()).toBe(1); // cache is warm

      mappingCleared = true; // the mapping row is gone

      const after = await action(CLIENT_1);
      expect(after).toEqual({ state: 'unmapped' });
      // The resolver was consulted again — no memoized resolution.
      expect(resolveCompanyIdMock).toHaveBeenCalledTimes(2);
    }
  );

  it('getHuduClientContext reports unmapped immediately after the clear (tabs disappear)', async () => {
    integrationRow = { tenant: TENANT, is_active: true, base_url: BASE_URL, settings: {} };
    let mappingCleared = false;
    resolveCompanyIdMock.mockImplementation(async () => (mappingCleared ? null : '101'));
    const { getHuduClientContext } = await importDataActions();

    expect(await getHuduClientContext(CLIENT_1)).toEqual({ connected: true, mapped: true });

    mappingCleared = true;

    expect(await getHuduClientContext(CLIENT_1)).toEqual({ connected: true, mapped: false });
  });

  it('reveal is blocked the moment the mapping is cleared (no Hudu call, no audit)', async () => {
    resolveCompanyIdMock.mockResolvedValue(null);
    const { revealHuduPassword } = await importDataActions();

    const result = await revealHuduPassword(CLIENT_1, 42);

    expect(result).toEqual({ state: 'unmapped' });
    expect(getAssetPasswordMock).not.toHaveBeenCalled();
    expect(revealAuditMock).not.toHaveBeenCalled();
  });
});
