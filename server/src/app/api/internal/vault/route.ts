import { NextRequest, NextResponse } from 'next/server';
import { VaultSecretProvider } from '../../../../../../shared/core/VaultSecretProvider.js';

// Cached vault provider instance
let vaultProviderInstance: VaultSecretProvider | null = null;

/**
 * Whitelist of allowed secret names that can be accessed via API
 */
const ALLOWED_SECRETS = new Set([
  'SECRET_KEY',
  'NEXTAUTH_SECRET',
  'KEYCLOAK_CLIENT_SECRET',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GMAIL_CLIENT_SECRET',
  'GRAPH_CLIENT_SECRET',
  'QBO_CLIENT_SECRET',
  'QBO_SANDBOX_CLIENT_SECRET',
  'postgres_password',
  'db_password_server',
  'db_password_admin',
  'db_password_hocuspocus',
]);

/**
 * Validates that the request is coming from localhost
 */
function validateLocalRequest(request: NextRequest): boolean {
  const host = request.headers.get('host');
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  
  // Check if host is localhost variants
  const isLocalHost = host && (
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:') ||
    host.startsWith('[::1]:')
  );
  
  // Ensure no forwarded headers (indicating proxy/external access)
  const hasNoForwarding = !forwarded && !realIp;
  
  return Boolean(isLocalHost && hasNoForwarding);
}

/**
 * Validates that a secret name is in the whitelist
 */
function validateSecretName(secretName: string): void {
  if (!ALLOWED_SECRETS.has(secretName)) {
    throw new Error(`Secret '${secretName}' is not in the allowed whitelist`);
  }
}

/**
 * Gets the vault provider instance
 */
async function getVaultProvider(): Promise<VaultSecretProvider> {
  if (!vaultProviderInstance) {
    vaultProviderInstance = new VaultSecretProvider();
  }
  return vaultProviderInstance;
}

/**
 * POST /api/internal/vault
 * Handles vault secret operations
 */
export async function POST(request: NextRequest) {
  try {
    // Enforce local-only access
    if (!validateLocalRequest(request)) {
      return NextResponse.json(
        { error: 'Access denied: This endpoint only accepts localhost requests' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { operation, secretName, tenantId, value } = body;

    // Validate required fields
    if (!operation || !secretName) {
      return NextResponse.json(
        { error: 'Missing required fields: operation and secretName' },
        { status: 400 }
      );
    }

    // Validate secret name against whitelist
    validateSecretName(secretName);

    const vaultProvider = await getVaultProvider();

    switch (operation) {
      case 'getAppSecret':
        const appSecret = await vaultProvider.getAppSecret(secretName);
        return NextResponse.json({ value: appSecret });

      case 'getTenantSecret':
        if (!tenantId) {
          return NextResponse.json(
            { error: 'tenantId is required for tenant operations' },
            { status: 400 }
          );
        }
        const tenantSecret = await vaultProvider.getTenantSecret(tenantId, secretName);
        return NextResponse.json({ value: tenantSecret });

      case 'setTenantSecret':
        if (!tenantId) {
          return NextResponse.json(
            { error: 'tenantId is required for tenant operations' },
            { status: 400 }
          );
        }
        await vaultProvider.setTenantSecret(tenantId, secretName, value);
        return NextResponse.json({ success: true });

      case 'deleteTenantSecret':
        if (!tenantId) {
          return NextResponse.json(
            { error: 'tenantId is required for tenant operations' },
            { status: 400 }
          );
        }
        await vaultProvider.deleteTenantSecret(tenantId, secretName);
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json(
          { error: `Unsupported operation: ${operation}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Vault API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}