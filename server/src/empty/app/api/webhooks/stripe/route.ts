/**
 * CE Stub for Stripe Webhook
 * In CE builds, Stripe webhooks are not available
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  return NextResponse.json(
    {
      error: 'Stripe integration is only available in Enterprise Edition',
    },
    { status: 501 }
  );
}
