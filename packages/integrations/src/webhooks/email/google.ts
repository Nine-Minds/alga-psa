import { NextRequest, NextResponse } from 'next/server';
import { handleGoogleWebhook } from './handlers/googleWebhookHandler';

export async function POST(request: NextRequest) {
  return handleGoogleWebhook(request);
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
