import { NextResponse } from 'next/server';
import { auth } from '../[...nextauth]/auth';

export async function GET() {
  try {
    // Full auth handler runs revocation checks so terminated sessions are removed promptly
    const session = await auth();
    return NextResponse.json(session ?? {});
  } catch (e) {
    return NextResponse.json({ error: 'failed_to_get_session' }, { status: 500 });
  }
}
