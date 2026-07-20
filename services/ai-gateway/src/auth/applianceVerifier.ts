import { createHash } from 'node:crypto';
import process from 'node:process';

import { AuthenticationError, AuthenticationServiceError } from './types.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_STUB_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export interface VerifiedAppliance {
  tenantId: string;
  edition: string;
}

export interface ApplianceCredentialVerifier {
  verify(credential: string): Promise<VerifiedAppliance>;
}

export class StubApplianceCredentialVerifier implements ApplianceCredentialVerifier {
  constructor(
    private readonly tenantId = DEFAULT_STUB_TENANT_ID,
    private readonly edition = 'enterprise',
  ) {}

  async verify(credential: string): Promise<VerifiedAppliance> {
    if (!credential.trim()) {
      throw new AuthenticationError();
    }
    return { tenantId: this.tenantId, edition: this.edition };
  }
}

export interface HttpApplianceCredentialVerifierOptions {
  licenseUrl: string;
  serviceToken: string;
  fetchImplementation?: typeof fetch;
}

export class HttpApplianceCredentialVerifier implements ApplianceCredentialVerifier {
  private readonly verifyUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: HttpApplianceCredentialVerifierOptions) {
    this.verifyUrl = `${options.licenseUrl.replace(/\/+$/, '')}/verify-appliance`;
    this.serviceToken = options.serviceToken.trim();
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async verify(credential: string): Promise<VerifiedAppliance> {
    if (!this.serviceToken || !this.verifyUrl.startsWith('http')) {
      throw new AuthenticationServiceError('Appliance verification is not configured');
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(this.verifyUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.serviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credential }),
      });
    } catch (error) {
      throw new AuthenticationServiceError('Appliance verification service is unavailable', {
        cause: error,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError();
    }
    if (!response.ok) {
      throw new AuthenticationServiceError(
        `Appliance verification service returned HTTP ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new AuthenticationServiceError('Appliance verification returned invalid JSON', {
        cause: error,
      });
    }

    if (
      typeof body !== 'object' ||
      body === null ||
      !('tenant_id' in body) ||
      typeof body.tenant_id !== 'string' ||
      !body.tenant_id.trim() ||
      !('edition' in body) ||
      typeof body.edition !== 'string' ||
      !body.edition.trim()
    ) {
      throw new AuthenticationServiceError('Appliance verification returned an invalid payload');
    }

    return {
      tenantId: body.tenant_id.trim(),
      edition: body.edition.trim(),
    };
  }
}

interface CachedVerification {
  value: VerifiedAppliance;
  expiresAt: number;
}

export class CachingApplianceCredentialVerifier implements ApplianceCredentialVerifier {
  private readonly cache = new Map<string, CachedVerification>();

  constructor(
    private readonly delegate: ApplianceCredentialVerifier,
    private readonly ttlMs = DEFAULT_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error('Appliance credential cache TTL must be a positive integer');
    }
  }

  async verify(credential: string): Promise<VerifiedAppliance> {
    const cacheKey = createHash('sha256').update(credential).digest('hex');
    const cached = this.cache.get(cacheKey);
    const now = this.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    if (cached) {
      this.cache.delete(cacheKey);
    }

    const value = await this.delegate.verify(credential);
    this.cache.set(cacheKey, {
      value,
      expiresAt: now + this.ttlMs,
    });
    return value;
  }
}

export function createApplianceCredentialVerifierFromEnvironment(): ApplianceCredentialVerifier {
  const delegate: ApplianceCredentialVerifier =
    process.env.ALGA_LICENSE_STUB?.toLowerCase() === 'true'
      ? new StubApplianceCredentialVerifier(
          process.env.ALGA_LICENSE_STUB_TENANT_ID?.trim() || DEFAULT_STUB_TENANT_ID,
          process.env.ALGA_LICENSE_STUB_EDITION?.trim() || 'enterprise',
        )
      : new HttpApplianceCredentialVerifier({
          licenseUrl: process.env.ALGA_LICENSE_URL?.trim() || '',
          serviceToken: process.env.ALGA_LICENSE_SERVICE_TOKEN?.trim() || '',
        });

  return new CachingApplianceCredentialVerifier(delegate);
}
