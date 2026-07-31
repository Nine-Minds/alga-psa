// LEVERAGE: pattern ai-gateway-auth-token — duplicated from
// ee/server/src/lib/aiGateway/client.ts; packages/ee cannot import ee/server
// (ee-stubs -> sebastian-ee project cycle, and ee/server is absent from CE
// builds). Consolidate when the gateway client moves to a shared package.
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

import {
  getLicenseStateRow,
  isSelfHostLicensing,
} from '@alga-psa/licensing';

const GATEWAY_TOKEN_TTL_SECONDS = 5 * 60;

function requireServiceSecret(): string {
  const value = process.env.AI_GATEWAY_SERVICE_SECRET?.trim();
  if (!value) {
    throw new Error('AI_GATEWAY_SERVICE_SECRET is not configured');
  }
  return value;
}

export function mintGatewayToken(tenantId: string): string {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    throw new Error('tenantId is required to mint an AI gateway token');
  }

  return jwt.sign({ tenant_id: normalizedTenantId }, requireServiceSecret(), {
    algorithm: 'HS256',
    expiresIn: GATEWAY_TOKEN_TTL_SECONDS,
    jwtid: randomUUID(),
  });
}

export async function resolveGatewayAuthToken(tenantId: string): Promise<string> {
  if (!(await isSelfHostLicensing())) {
    return mintGatewayToken(tenantId);
  }

  const licenseState = await getLicenseStateRow();
  const applianceCredential = licenseState?.appliance_credential?.trim();
  if (!applianceCredential) {
    throw new Error(
      'AI gateway authentication requires an appliance credential on self-hosted installs',
    );
  }
  return applianceCredential;
}
