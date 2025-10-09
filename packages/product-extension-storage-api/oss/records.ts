import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(..._args: any[]): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Extension storage API is available in the enterprise edition.' },
    { status: 404 },
  );
}

export async function POST(..._args: any[]): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Extension storage API is available in the enterprise edition.' },
    { status: 404 },
  );
}
