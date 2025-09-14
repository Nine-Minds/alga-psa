import { NextRequest } from 'next/server';
import { ChatStreamService } from '@product/chat/entry';

// This is needed for streaming responses
export const dynamic = 'force-dynamic';
// export const runtime = 'edge'; // Temporarily disabled

export async function POST(req: NextRequest) {
  return ChatStreamService.handleTitleStream(req);
}
