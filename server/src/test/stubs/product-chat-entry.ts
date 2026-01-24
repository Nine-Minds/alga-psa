export const ChatCompletionsService = {
  async handleRequest(_req: Request): Promise<Response> {
    return new Response(JSON.stringify({ error: 'stubbed chat entry' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

