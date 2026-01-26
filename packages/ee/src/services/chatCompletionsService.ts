export class ChatCompletionsService {
  constructor() {
    throw new Error('ChatCompletionsService is an Enterprise Edition feature.');
  }

  static async handleRequest(_req: Request): Promise<Response> {
    return new Response(
      JSON.stringify({ error: 'Chat completions are only available in Enterprise Edition' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  static async handleExecute(_req: Request): Promise<Response> {
    return new Response(
      JSON.stringify({ error: 'Chat completions are only available in Enterprise Edition' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
