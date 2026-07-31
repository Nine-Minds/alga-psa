/**
 * Script Execution API Routes
 * Path: /api/v1/assets/[id]/rmm/script
 *
 * POST - Runs a script on the RMM-managed device
 *
 * Request body:
 * - scriptId: string - The NinjaOne script ID to run
 */

import { NextResponse } from 'next/server';
import { triggerRmmScript } from '@/lib/actions/asset-actions/rmmActions';
import { rmmErrorResponse, rmmRouteErrorFrom } from '../rmmRouteErrors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    let body: { scriptId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const scriptId = typeof body.scriptId === 'string' ? body.scriptId.trim() : '';

    if (!scriptId) {
      return NextResponse.json(
        { error: 'Missing scriptId in request body' },
        { status: 400 }
      );
    }

    const result = await triggerRmmScript(id, scriptId);

    if (!result.success) {
      const expectedError = rmmRouteErrorFrom(result.message);
      return NextResponse.json(
        {
          success: false,
          message: result.message,
        },
        { status: expectedError?.status ?? 400 }
      );
    }

    return NextResponse.json({
      success: true,
      jobId: result.jobId,
      message: result.message,
      _links: {
        self: { href: `/api/v1/assets/${id}/rmm/script`, method: 'POST' },
        asset: { href: `/api/v1/assets/${id}` },
        rmmData: { href: `/api/v1/assets/${id}/rmm` },
      },
    });
  } catch (error) {
    console.error('Failed to run script:', error);
    const expectedError = rmmRouteErrorFrom(error);
    if (expectedError) {
      return rmmErrorResponse(expectedError);
    }
    return NextResponse.json(
      { error: 'Failed to run script' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
