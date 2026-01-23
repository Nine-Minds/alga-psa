/**
 * API routes for individual tenant secret management.
 *
 * These routes provide REST API access to specific tenant secrets by name.
 * The actual secret values are NEVER returned through any API endpoint -
 * only metadata is exposed. Secret resolution happens only at workflow runtime.
 *
 * §18.7.2 - API route shims delegating to server actions
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getSecretMetadata,
  secretExists,
  updateSecret,
  deleteSecret
} from '@/lib/actions/tenant-secret-actions';

type RouteParams = {
  params: Promise<{ name: string }>;
};

/**
 * GET /api/secrets/[name]
 *
 * Get metadata for a specific secret.
 * Returns metadata only - never includes the actual secret value.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { name } = await params;

    const secret = await getSecretMetadata(name);

    if (!secret) {
      return NextResponse.json(
        { error: `Secret "${name}" not found` },
        { status: 404 }
      );
    }

    return NextResponse.json(secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get secret';
    const status = message.includes('Permission denied') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * HEAD /api/secrets/[name]
 *
 * Check if a secret exists.
 * Returns 200 if exists, 404 if not.
 */
export async function HEAD(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { name } = await params;

    const exists = await secretExists(name);

    if (!exists) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    return new NextResponse(null, { status: 500 });
  }
}

/**
 * PATCH /api/secrets/[name]
 *
 * Update an existing secret.
 * Requires secrets.manage permission.
 *
 * Body:
 * - value: string (optional) - New secret value
 * - description: string (optional) - New description
 *
 * At least one of value or description must be provided.
 * Returns the updated secret's metadata (never includes the value).
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { name } = await params;
    const body = await request.json();

    const { value, description } = body;

    if (value === undefined && description === undefined) {
      return NextResponse.json(
        { error: 'At least one of value or description must be provided' },
        { status: 400 }
      );
    }

    const updated = await updateSecret(name, { value, description });

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update secret';
    const status = message.includes('Permission denied') ? 403 :
                   message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/secrets/[name]
 *
 * Delete a secret.
 * Requires secrets.manage permission.
 *
 * Warning: Deleting a secret that is referenced by workflows will cause
 * those workflows to fail when they try to access the secret.
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { name } = await params;

    await deleteSecret(name);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete secret';
    const status = message.includes('Permission denied') ? 403 :
                   message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
