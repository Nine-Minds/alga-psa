/**
 * Remote Control API Routes
 * Path: /api/v1/assets/[id]/rmm/remote-control
 *
 * GET - Returns remote control URL for the asset
 *
 * Query parameters:
 * - type: 'splashtop' | 'teamviewer' | 'vnc' | 'rdp' | 'shell' (default: 'splashtop')
 */

import { NextResponse } from 'next/server';
import { getAssetRemoteControlUrl } from '@ee/lib/actions/asset-actions/rmmActions';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing asset ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const connectionType = (url.searchParams.get('type') || 'splashtop') as
      | 'splashtop'
      | 'teamviewer'
      | 'vnc'
      | 'rdp'
      | 'shell';

    const remoteControlUrl = await getAssetRemoteControlUrl(id, connectionType);

    if (!remoteControlUrl) {
      return NextResponse.json({
        data: null,
        message: 'Remote control not available for this asset',
      });
    }

    return NextResponse.json({
      data: {
        url: remoteControlUrl,
        type: connectionType,
      },
      _links: {
        self: { href: `/api/v1/assets/${id}/rmm/remote-control` },
        asset: { href: `/api/v1/assets/${id}` },
        rmmData: { href: `/api/v1/assets/${id}/rmm` },
      },
    });
  } catch (error) {
    console.error('Failed to get remote control URL:', error);
    return NextResponse.json(
      { error: 'Failed to get remote control URL' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
