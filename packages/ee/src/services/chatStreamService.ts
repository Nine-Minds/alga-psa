import { NextRequest } from 'next/server';

export class ChatStreamService {
  static async handleChatStream(req: NextRequest) {
    return new Response(JSON.stringify({ error: 'Chat streaming is only available in Enterprise Edition' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  static async handleTitleStream(req: NextRequest) {
    return new Response(JSON.stringify({ error: 'Title streaming is only available in Enterprise Edition' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
