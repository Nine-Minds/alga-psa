import crypto from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import type { InboundWebhookAuthStatus } from './types';

export interface VerifyInboundWebhookAuthInput {
  tenant: string;
  authType: string;
  authConfig: Record<string, unknown>;
  headers: Headers;
  rawBody: string;
  sourceIp?: string | null;
  url: URL;
}

export interface VerifyInboundWebhookAuthResult {
  verified: boolean;
  authStatus: InboundWebhookAuthStatus;
}

export async function verifyInboundWebhookAuth(
  input: VerifyInboundWebhookAuthInput,
): Promise<VerifyInboundWebhookAuthResult> {
  switch (input.authType) {
    case 'hmac_sha256':
      return verifyHmac(input);
    case 'bearer':
      return verifyBearer(input);
    case 'ip_allowlist':
      return verifyIpAllowlist(input);
    case 'path_token':
      return verifyPathToken(input);
    default:
      return { verified: false, authStatus: 'rejected_no_auth' };
  }
}

async function verifyHmac(input: VerifyInboundWebhookAuthInput): Promise<VerifyInboundWebhookAuthResult> {
  const signatureHeader = String(
    input.authConfig.signature_header ?? input.authConfig.signatureHeader ?? 'X-Alga-Signature',
  );
  const providedSignature = input.headers.get(signatureHeader);
  const secret = await readConfiguredSecret(input.tenant, input.authConfig, 'secret');

  if (!providedSignature || !secret) {
    return { verified: false, authStatus: 'rejected_signature' };
  }

  const expected = crypto.createHmac('sha256', secret).update(input.rawBody).digest('hex');
  return timingSafeCompare(normalizeSignature(providedSignature), expected)
    ? { verified: true, authStatus: 'verified' }
    : { verified: false, authStatus: 'rejected_signature' };
}

async function verifyBearer(input: VerifyInboundWebhookAuthInput): Promise<VerifyInboundWebhookAuthResult> {
  const authorization = input.headers.get('authorization') ?? '';
  const provided = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : '';
  const expected = await readConfiguredSecret(input.tenant, input.authConfig, 'token');

  if (!provided || !expected) {
    return { verified: false, authStatus: 'rejected_bearer' };
  }

  return timingSafeCompare(provided, expected)
    ? { verified: true, authStatus: 'verified' }
    : { verified: false, authStatus: 'rejected_bearer' };
}

function verifyIpAllowlist(input: VerifyInboundWebhookAuthInput): VerifyInboundWebhookAuthResult {
  const cidrs = Array.isArray(input.authConfig.ip_cidrs)
    ? input.authConfig.ip_cidrs.map(String)
    : Array.isArray(input.authConfig.ipCidrs)
      ? input.authConfig.ipCidrs.map(String)
      : [];

  if (!input.sourceIp || cidrs.length === 0) {
    return { verified: false, authStatus: 'rejected_ip' };
  }

  return cidrs.some((cidr) => isIpAllowed(input.sourceIp!, cidr))
    ? { verified: true, authStatus: 'verified' }
    : { verified: false, authStatus: 'rejected_ip' };
}

async function verifyPathToken(input: VerifyInboundWebhookAuthInput): Promise<VerifyInboundWebhookAuthResult> {
  const queryParam = String(input.authConfig.query_param ?? input.authConfig.queryParam ?? 'token');
  const provided = input.url.searchParams.get(queryParam) ?? '';
  const expected = await readConfiguredSecret(input.tenant, input.authConfig, 'token');

  if (!provided || !expected) {
    return { verified: false, authStatus: 'rejected_no_auth' };
  }

  return timingSafeCompare(provided, expected)
    ? { verified: true, authStatus: 'verified' }
    : { verified: false, authStatus: 'rejected_no_auth' };
}

async function readConfiguredSecret(
  tenant: string,
  config: Record<string, unknown>,
  kind: 'secret' | 'token',
): Promise<string | undefined> {
  const vaultPath = String(
    kind === 'secret'
      ? config.secret_vault_path ?? config.secretVaultPath ?? ''
      : config.token_vault_path ?? config.tokenVaultPath ?? '',
  );

  if (!vaultPath) {
    return undefined;
  }

  const secretProvider = await getSecretProviderInstance();
  return secretProvider.getTenantSecret(tenant, vaultPath.split('/').filter(Boolean).at(-1) ?? vaultPath);
}

function normalizeSignature(signature: string): string {
  const trimmed = signature.trim();
  return trimmed.startsWith('sha256=') ? trimmed.slice('sha256='.length) : trimmed;
}

export function timingSafeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  const maxLength = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(maxLength);
  const paddedRight = Buffer.alloc(maxLength);

  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);

  return crypto.timingSafeEqual(paddedLeft, paddedRight) && leftBuffer.length === rightBuffer.length;
}

function isIpAllowed(ip: string, cidr: string): boolean {
  const [range, prefixRaw] = cidr.split('/');
  if (!prefixRaw) {
    return ip === range;
  }

  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  const prefix = Number(prefixRaw);

  if (ipInt === null || rangeInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    result = (result << 8) + value;
  }

  return result >>> 0;
}
