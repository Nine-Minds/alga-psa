/**
 * API routes for tenant secrets management.
 *
 * These routes provide REST API access to tenant-scoped secrets.
 * The actual secret values are NEVER returned through any API endpoint -
 * only metadata is exposed. Secret resolution happens only at workflow runtime.
 *
 * §18.7.2 - API route shims delegating to server actions
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  listTenantSecrets,
  createSecret,
  getSecretUsage
} from '@/lib/actions/tenant-secret-actions';

/**
 * GET /api/secrets
 *
 * List all secrets for the current tenant.
 * Returns metadata only - never includes actual secret values.
 *
 * Query params:
 * - includeUsage=true: Include workflow usage info for each secret
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeUsage = searchParams.get('includeUsage') === 'true';

    const secrets = await listTenantSecrets();

    if (includeUsage) {
      const usageMap = await getSecretUsage();
      const secretsWithUsage = secrets.map(secret => ({
        ...secret,
        workflowUsage: usageMap.get(secret.name) ?? []
      }));
      return NextResponse.json(secretsWithUsage);
    }

    return NextResponse.json(secrets);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list secrets';
    const status = message.includes('Permission denied') ? 403 :
                   message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * POST /api/secrets
 *
 * Create a new tenant secret.
 * Requires secrets.manage permission.
 *
 * Body:
 * - name: string (required) - Secret name (UPPER_SNAKE_CASE)
 * - value: string (required) - Secret value (will be encrypted)
 * - description: string (optional) - Human-readable description
 *
 * Returns the created secret's metadata (never includes the value).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { name, value, description } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Secret name is required' },
        { status: 400 }
      );
    }

    if (!value || typeof value !== 'string') {
      return NextResponse.json(
        { error: 'Secret value is required' },
        { status: 400 }
      );
    }

    const secret = await createSecret({ name, value, description });

    return NextResponse.json(secret, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create secret';
    const status = message.includes('Permission denied') ? 403 :
                   message.includes('already exists') ? 409 :
                   message.includes('validation') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
