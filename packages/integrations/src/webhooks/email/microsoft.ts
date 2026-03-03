import { NextRequest, NextResponse } from 'next/server';
import {
  handleMicrosoftWebhookGet,
  handleMicrosoftWebhookPost,
} from './handlers/microsoftWebhookHandler';

export async function GET(request: NextRequest) {
  return handleMicrosoftWebhookGet(request);
}

export async function POST(request: NextRequest) {
  return handleMicrosoftWebhookPost(request);
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
