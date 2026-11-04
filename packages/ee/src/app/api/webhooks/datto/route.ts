/**
 * Empty Datto RMM Webhook Route for Community Edition
 *
 * The Datto RMM integration is only available in the Enterprise Edition.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json(
    { error: 'Datto RMM integration is only available in the Enterprise Edition' },
    { status: 404 }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
