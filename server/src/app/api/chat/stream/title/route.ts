import { NextRequest } from 'next/server';
import { ChatStreamService } from '@ee/services/chatStreamService';

// This is needed for streaming responses
export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function POST(req: NextRequest) {
  return ChatStreamService.handleTitleStream(req);
}
