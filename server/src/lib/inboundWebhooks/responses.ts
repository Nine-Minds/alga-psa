import { NextResponse } from 'next/server';

export function unauthorizedInboundWebhookResponse(): NextResponse {
  return new NextResponse(null, {
    status: 401,
  });
}
