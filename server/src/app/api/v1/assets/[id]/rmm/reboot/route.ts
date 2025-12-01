/**
 * Device Reboot API Routes
 * Path: /api/v1/assets/[id]/rmm/reboot
 *
 * POST - Triggers a reboot on the RMM-managed device
 */

import { NextResponse } from 'next/server';
import { triggerRmmReboot } from '../../../../../../../../../ee/server/src/lib/actions/asset-actions/rmmActions';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const result = await triggerRmmReboot(id);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      _links: {
        self: { href: `/api/v1/assets/${id}/rmm/reboot`, method: 'POST' },
        asset: { href: `/api/v1/assets/${id}` },
        rmmData: { href: `/api/v1/assets/${id}/rmm` },
      },
    });
  } catch (error) {
    console.error('Failed to trigger device reboot:', error);
    return NextResponse.json(
      { error: 'Failed to trigger device reboot' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
