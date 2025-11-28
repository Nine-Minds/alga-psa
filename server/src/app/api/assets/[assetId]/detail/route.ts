import { NextResponse } from 'next/server';
import { loadAssetDetailDrawerData } from 'server/src/components/assets/AssetDetailDrawer';

export async function GET(request: Request, { params }: { params: { assetId: string } }) {
  const { assetId } = params;
  if (!assetId) {
    return NextResponse.json({ error: 'Missing assetId' }, { status: 400 });
  }

  const url = new URL(request.url);
  const panel = url.searchParams.get('panel');

  try {
    const result = await loadAssetDetailDrawerData({ assetId, panel });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to load asset detail drawer data', error);
    return NextResponse.json({ error: 'Unable to load asset details.' }, { status: 500 });
  }
}
