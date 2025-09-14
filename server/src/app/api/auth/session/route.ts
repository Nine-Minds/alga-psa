import { NextResponse } from 'next/server';
import { auth } from '../[...nextauth]/edge-auth';

export const runtime = 'edge';

export async function GET() {
  try {
    const session = await auth();
    return NextResponse.json(session ?? {});
  } catch (e) {
    return NextResponse.json({ error: 'failed_to_get_session' }, { status: 500 });
  }
}

